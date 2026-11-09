import type { Query, QueryClient } from '@tanstack/react-query';

import { noop } from '@tanstack/react-query';
import {
    persistQueryClient,
    persistQueryClientSave,
    type PersistedClient,
    type Persister
} from '@tanstack/react-query-persist-client';
import { del, get, set } from 'idb-keyval';

import { accountSnapshot, cacheOwner, profileOwner } from '#/integrations/offline/account-cache';
import { PAGES_CACHE_PREFIX, pagesCacheName } from '#/integrations/offline/pages-cache';
import { localStorageRepository } from '#/lib/local-storage';
import { openLocal, sealLocal, retentionDays } from '#/lib/local-vault';
import { meQueryOptions } from '#/queries/me';
import { isRecommendationsKey } from '#/queries/recommendations';

// também é o gcTime das queries no navegador, senão a query sai do cache antes de vencer no disco
export const PERSIST_MAX_AGE = 400 * 24 * 60 * 60 * 1000;
export function localRetentionMs() {
    return (
        retentionDays(typeof window === 'undefined' ? undefined : window.localStorage) * 86400_000
    );
}
const RESTORE_TIMEOUT_MS = 3_000;

// sem IndexedDB (SSR) não há persistência
interface EncryptedPersister extends Persister {
    settle: () => Promise<void>;
}
export function encryptedQueryPersister(
    identity: () => string | null | undefined = () => undefined,
    beforeOfflineRestore: () => void = noop,
    canWrite: () => boolean = () => true
): EncryptedPersister {
    let generation = 0;
    let writing = Promise.resolve();
    let unreadable = false;
    const key = 'followw-query-cache';
    const publicKey = 'followw-public-query-cache';
    return {
        persistClient: (client) => {
            if (!canWrite()) return Promise.resolve();
            const current = generation;
            const save = writing.then(async () => {
                if (current !== generation || unreadable || !canWrite()) return undefined;
                const owner = cacheOwner(client);
                const snapshot = owner ? client : accountSnapshot(client, null, true);
                const sealed = await sealLocal(
                    { ...snapshot, buster: cacheBuster() },
                    'query-cache'
                );
                if (current === generation) await set(owner ? key : publicKey, sealed);
                return undefined;
            });
            writing = save.catch(noop);
            return save;
        },
        restoreClient: async (): Promise<PersistedClient | undefined> => {
            const current = generation;
            try {
                const saved = (await get<unknown>(key)) ?? (await get<unknown>(publicKey));
                if (!saved) return undefined;
                const value: unknown =
                    typeof saved === 'string' && saved.startsWith('v1.')
                        ? await openLocal(saved, 'query-cache')
                        : typeof saved === 'string'
                          ? JSON.parse(saved)
                          : saved;
                if (
                    !value ||
                    typeof value !== 'object' ||
                    !('clientState' in value) ||
                    !('timestamp' in value)
                )
                    throw new Error('Cache inválido');
                // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- contrato persistido é validado também pelo TanStack
                const client = value as PersistedClient;
                client.clientState.queries = client.clientState.queries.filter(
                    (query) => Date.now() - query.state.dataUpdatedAt < localRetentionMs()
                );
                client.clientState.mutations = [];
                if (current !== generation) return undefined;
                if (!(typeof saved === 'string' && saved.startsWith('v1.'))) {
                    const sealed = await sealLocal(client, 'query-cache');
                    if (current !== generation) return undefined;
                    await set(key, sealed);
                }
                if (current !== generation) return undefined;
                const online = typeof navigator === 'undefined' || navigator.onLine;
                const owner = identity();
                const restored = accountSnapshot(client, owner, online);
                if (
                    !online &&
                    !owner &&
                    cacheOwner(restored) &&
                    client.buster === cacheBuster() &&
                    Date.now() - client.timestamp <= localRetentionMs()
                )
                    beforeOfflineRestore();
                return restored;
            } catch {
                unreadable = true;
                return undefined;
            }
        },
        removeClient: async () => {
            generation++;
            await writing;
            unreadable = false;
            await Promise.all([del(key), del(publicKey)]);
        },
        settle: () => writing
    };
}

let persister = typeof indexedDB === 'undefined' ? null : encryptedQueryPersister();
const persisters = new WeakMap<QueryClient, EncryptedPersister>();
const pausedClients = new WeakSet<QueryClient>();

const cacheBuster = () =>
    `${import.meta.env.VITE_QUERY_CACHE_BUSTER ?? 'dev'}:${localStorageRepository.get<number>('cache-epoch') ?? 0}`;

function accountPersister(queryClient: QueryClient) {
    if (typeof indexedDB === 'undefined') return null;
    let current = persisters.get(queryClient);
    if (!current) {
        current = encryptedQueryPersister(
            () => {
                const user = queryClient.getQueryData(meQueryOptions.queryKey);
                return user === undefined ? undefined : profileOwner(user);
            },
            () => queryClient.removeQueries({ queryKey: meQueryOptions.queryKey, exact: true }),
            () => !pausedClients.has(queryClient)
        );
        persisters.set(queryClient, current);
    }
    persister = current;
    return current;
}

export async function withPausedOfflineWrites<T>(
    queryClient: QueryClient,
    task: () => Promise<T>
): Promise<T> {
    const current = accountPersister(queryClient);
    pausedClients.add(queryClient);
    try {
        await current?.settle();
        return await task();
    } finally {
        pausedClients.delete(queryClient);
        if (current)
            void persistQueryClientSave({
                queryClient,
                persister: current,
                buster: cacheBuster(),
                dehydrateOptions: {
                    shouldDehydrateQuery: (query) => shouldPersistQuery(query),
                    shouldDehydrateMutation: () => false
                }
            }).catch(noop);
    }
}

export async function restoreAccountCache(queryClient: QueryClient) {
    const saved = await accountPersister(queryClient)?.restoreClient();
    if (saved?.buster === cacheBuster() && Date.now() - saved.timestamp <= localRetentionMs()) {
        const { hydrate } = await import('@tanstack/react-query');
        hydrate(queryClient, saved.clientState);
    }
}

const isSupportKey = (key: readonly unknown[]) =>
    typeof key[1] === 'string' && key[1].startsWith('/support');

// sem isso, query sem uso (ex.: cardápio de semana antiga) é salva de novo a cada sessão e nunca sai
export function shouldPersistQuery(query: Query, now = Date.now()) {
    return (
        !isRecommendationsKey(query.queryKey) &&
        // chamados: a chave secreta vai nos parâmetros da consulta e o texto não precisa de cópia no cache
        !isSupportKey(query.queryKey) &&
        query.state.status === 'success' &&
        now - query.state.dataUpdatedAt < localRetentionMs()
    );
}

/** Restaura o cache salvo no IndexedDB (avisando em `onRestored`) e salva cada mudança; devolve a função que para de salvar. */
export function persistQueryCache(queryClient: QueryClient, onRestored: () => void = noop) {
    const current = accountPersister(queryClient);
    if (!current) {
        onRestored();
        return noop;
    }
    const [unsubscribe, restoring] = persistQueryClient({
        queryClient,
        persister: current,
        maxAge: localRetentionMs(),
        buster: cacheBuster(),
        dehydrateOptions: {
            shouldDehydrateQuery: (query) => shouldPersistQuery(query),
            shouldDehydrateMutation: () => false
        }
    });
    // falha ao restaurar já descarta o cache salvo; IndexedDB travado (ex.: exclusão pendente
    // noutra aba) não pode prender o app sem dados: depois do limite, segue pela rede
    let done = false;
    const finish = () => {
        if (done) return;
        done = true;
        onRestored();
    };
    const timer = setTimeout(finish, RESTORE_TIMEOUT_MS);
    restoring.catch(noop).finally(() => {
        clearTimeout(timer);
        finish();
    });
    return unsubscribe;
}

async function deletePageCaches(keep?: string) {
    const names = await caches.keys();
    await Promise.all(
        names
            .filter((name) => name.startsWith(PAGES_CACHE_PREFIX) && name !== keep)
            .map((name) => caches.delete(name))
    );
}

let pageGeneration = 0;
let warming: Promise<void> | undefined;

async function cachePage(cache: Cache, url: string, generation: number) {
    if (await cache.match(url)) return;
    // oxlint-disable-next-line no-restricted-globals -- baixa o HTML da própria página, não a API
    const response = await fetch(url, { credentials: 'omit' });
    // navegação não aceita resposta redirecionada (ex.: /perfil → /login)
    if (generation === pageGeneration && response.ok && !response.redirected)
        await cache.put(url, response);
}

/** Baixa para o cache do SW as páginas principais que faltam e apaga os caches de builds antigos. */
export async function warmPages(_loggedIn: boolean) {
    if (warming) return warming;
    const generation = pageGeneration;
    const task = (async () => {
        const current = pagesCacheName(import.meta.env.VITE_BUILD_ID ?? 'dev');
        const cache = await caches.open(current);
        const urls = ['/', '/ru', '/turmas', '/login'];
        await Promise.allSettled(urls.map((url) => cachePage(cache, url, generation)));
        const complete = (await Promise.all(urls.map((url) => cache.match(url)))).every(Boolean);
        if (generation === pageGeneration && complete) await deletePageCaches(current);
    })();
    warming = task;
    try {
        await task;
    } finally {
        if (warming === task) warming = undefined;
    }
}

/** Apaga do dispositivo os dados da API e o HTML das páginas, que também traz dados do SSR. */
export async function clearOfflineData() {
    pageGeneration++;
    warming = undefined;
    localStorageRepository.set(
        'cache-epoch',
        (localStorageRepository.get<number>('cache-epoch') ?? 0) + 1
    );
    await Promise.all([
        persister?.removeClient(),
        typeof caches !== 'undefined' && deletePageCaches()
    ]);
}
