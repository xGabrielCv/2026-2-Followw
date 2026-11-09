import { createIsomorphicFn } from '@tanstack/react-start';
import createClient, { type Middleware } from 'openapi-fetch';

import type { paths } from '#/queries/schema.gen.ts';

import {
    type AuthorKind,
    keyFor,
    legacySecret,
    newKey,
    rememberKeyAt,
    usageHeader
} from '#/lib/author';
import { flushLocalStorage, localAccount, localStorageRepository } from '#/lib/local-storage';
import { initializeLocalVault } from '#/lib/local-vault';
import { communityRequest } from '#/queries/community-permissions';
import { toApiError } from '#/queries/errors.ts';

// a API fica em /api da mesma origem; no SSR o fetch exige URL absoluta, e a origem provisória é
// trocada pelo destino interno configurado (veja `ssrMiddleware`)
const baseUrl = createIsomorphicFn()
    .client(() => '/api')
    .server(() => 'http://localhost/api')();

const getSsrHeaders = createIsomorphicFn()
    .client(() => new Headers())
    .server(async () => {
        const headers = new Headers();
        try {
            const { getRequest } = await import('@tanstack/react-start/server');
            const incoming = getRequest();
            const cookie = incoming.headers.get('cookie');
            if (cookie) headers.set('cookie', cookie);
            // a assinatura do IP é opcional: falhar aqui não pode derrubar a sessão
            const { clientIpHeaders } = await import('#/queries/client-ip.server');
            clientIpHeaders(incoming).forEach((value, name) => headers.set(name, value));
        } catch {}
        return headers;
    });

const toSsrOrigin = createIsomorphicFn()
    .client((request: Request) => request)
    .server(async (request: Request) => {
        const { serverApiUrl } = await import('#/queries/api-origin.server');
        const { pathname, search } = new URL(request.url);
        return new Request(serverApiUrl(pathname + search), request);
    });

const forwardSsrSetCookie = createIsomorphicFn()
    .client((_cookies: string[]) => {})
    .server(async (cookies: string[]) => {
        const { setResponseHeader } = await import('@tanstack/react-start/server');
        try {
            setResponseHeader('set-cookie', cookies);
        } catch {}
    });

const ssrMiddleware: Middleware = {
    async onRequest({ request: original }) {
        const request = await toSsrOrigin(original);
        const headers = await getSsrHeaders();
        headers.forEach((value, name) => request.headers.set(name, value));
        return request;
    },
    async onResponse({ response }) {
        const cookies = response.headers.getSetCookie();
        if (cookies.length) await forwardSsrSetCookie(cookies);
    }
};

const errorHandlingMiddleware: Middleware = {
    async onResponse({ response }) {
        if (!response.ok) {
            const body = await response
                .clone()
                .json()
                .catch(() => null);
            throw toApiError(response.status, body);
        }
    }
};

export const apiClient = createClient<paths>({
    baseUrl,
    fetch: (request) => globalThis.fetch(request),
    credentials: 'include'
});

// Autoria: cada publicação leva uma chave ALEATÓRIA própria (criada aqui) e o servidor guarda só um
// verificador dela. Nada identifica o aluno ou o aparelho entre publicações, e nunca vem da matrícula.
const route = (request: Request) => {
    const path = new URL(request.url).pathname.replace(/^\/api/, '');
    return { method: request.method, parts: path.split('/').filter(Boolean) };
};

/** Que credencial este pedido usa: uma nova (criação) ou a guardada da publicação (apagar). */
function authorKey({ method, parts }: ReturnType<typeof route>): string | undefined {
    const [root, id, child, childId] = parts;
    if (method === 'POST' && (root === 'tutorials' || root === 'materials') && parts.length <= 2)
        return newKey();
    if (method === 'POST' && root === 'forum') {
        if (parts.length === 1 || (parts.length === 3 && child === 'replies')) return newKey();
    }
    if (
        (method === 'DELETE' || (method === 'PATCH' && child === 'resolved')) &&
        root === 'forum' &&
        id
    ) {
        const stored =
            child === 'replies' && childId ? keyFor('reply', childId) : keyFor('post', id);
        return stored ?? legacySecret();
    }
    if (method === 'DELETE' && root === 'materials' && childId === undefined && child)
        return keyFor('material', child) ?? legacySecret();
    return undefined;
}

const KIND_BY_ROOT: Record<string, AuthorKind | undefined> = {
    forum: 'post',
    materials: 'material',
    tutorials: 'tutorial'
};

const pendingAuthors = new Map<string, string>();

const authorMiddleware: Middleware = {
    async onRequest({ request, id }) {
        const account = localAccount();
        if (typeof indexedDB !== 'undefined') await initializeLocalVault();
        const where = route(request);
        const key = authorKey(where);
        if (key && where.method === 'POST') pendingAuthors.set(id, account);
        if (key) request.headers.set('X-Followw-Author', key);
        // quem abriu a conversa prova isso ao responder (a chave do post nunca sai de outro jeito)
        if (where.method === 'POST' && where.parts[0] === 'forum' && where.parts[2] === 'replies') {
            const op = keyFor('post', where.parts[1]);
            if (op) request.headers.set('X-Followw-Op-Key', op);
        }
        // métricas opcionais: três chaves aleatórias de período, só no login/renovação e com consentimento
        if (
            localStorageRepository.get('analytics-consent') === true &&
            where.parts[0] === 'auth' &&
            where.parts[1] === 'sigaa'
        ) {
            request.headers.set('X-Followw-Metrics', '1');
            request.headers.set('X-Followw-Usage', usageHeader());
        }
        return request;
    },
    async onResponse({ request, response, id }) {
        const account = pendingAuthors.get(id);
        pendingAuthors.delete(id);
        const created = response.headers.get('X-Created-Id');
        const key = request.headers.get('X-Followw-Author');
        if (!response.ok || !created || !key || account === undefined) return;
        const { method, parts } = route(request);
        if (method !== 'POST') return;
        // o id novo vem do servidor; a chave só existe aqui
        const kind =
            parts[0] === 'forum' && parts[2] === 'replies' ? 'reply' : KIND_BY_ROOT[parts[0]];
        if (kind) {
            rememberKeyAt(account, kind, created, key);
            await flushLocalStorage();
        }
    },
    onError({ id }) {
        pendingAuthors.delete(id);
    }
};

apiClient.use(errorHandlingMiddleware);
apiClient.use(authorMiddleware);
apiClient.use(ssrMiddleware);
apiClient.use({
    async onRequest({ request, options, id }) {
        try {
            return await communityRequest(request, options.fetch);
        } catch (error) {
            pendingAuthors.delete(id);
            throw error;
        }
    }
});
