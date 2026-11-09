import type { Query, QueryClient } from '@tanstack/react-query';

import { noop } from '@tanstack/react-query';
import {
    persistQueryClient,
    type PersistedClient,
    type Persister
} from '@tanstack/react-query-persist-client';
import { del, get, set } from 'idb-keyval';

import { PAGES_CACHE_PREFIX, pagesCacheName } from '#/integrations/offline/pages-cache';
import { openLocal, sealLocal, retentionDays } from '#/lib/local-vault';
import { isRecommendationsKey } from '#/queries/recommendations';

// também é o gcTime das queries no navegador, senão a query sai do cache antes de vencer no disco
export const PERSIST_MAX_AGE = 90 * 24 * 60 * 60 * 1000;
export function localRetentionMs() {
    return (
        retentionDays(typeof window === 'undefined' ? undefined : window.localStorage) * 86400_000
    );
}
const RESTORE_TIMEOUT_MS = 3_000;

// sem IndexedDB (SSR) não há persistência
export function encryptedQueryPersister(): Persister {
    let generation = 0;
    let writing = Promise.resolve();
    let unreadable = false;
    const key = 'followw-query-cache';
    return {
        persistClient: (client) => {
            const current = generation;
            const save = writing.then(async () => {
                if (current !== generation || unreadable) return undefined;
                const sealed = await sealLocal(client, 'query-cache');
                if (current === generation) await set(key, sealed);
                return undefined;
            });
            writing = save.catch(noop);
            return save;
        },
        restoreClient: async (): Promise<PersistedClient | undefined> => {
            const current = generation;
            try {
                const saved = await get<unknown>(key);
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
                return client;
            } catch {
                unreadable = true;
                return undefined;
            }
        },
        removeClient: async () => {
            generation++;
            await writing;
            unreadable = false;
            await del(key);
        }
    };
}

const persister = typeof indexedDB === 'undefined' ? null : encryptedQueryPersister();

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
    if (!persister) {
        onRestored();
        return noop;
    }
    const [unsubscribe, restoring] = persistQueryClient({
        queryClient,
        persister,
        maxAge: localRetentionMs(),
        buster: import.meta.env.VITE_QUERY_CACHE_BUSTER,
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

async function cachePage(cache: Cache, url: string) {
    if (await cache.match(url)) return;
    // oxlint-disable-next-line no-restricted-globals -- baixa o HTML da própria página, não a API
    const response = await fetch(url, { credentials: 'omit' });
    // navegação não aceita resposta redirecionada (ex.: /perfil → /login)
    if (response.ok && !response.redirected) await cache.put(url, response);
}

/** Baixa para o cache do SW as páginas principais que faltam e apaga os caches de builds antigos. */
export async function warmPages(_loggedIn: boolean) {
    const current = pagesCacheName(import.meta.env.VITE_BUILD_ID ?? 'dev');
    await deletePageCaches(current);
    const cache = await caches.open(current);
    const urls = ['/', '/ru', '/turmas', '/login'];
    await Promise.allSettled(urls.map((url) => cachePage(cache, url)));
}

/** Apaga do dispositivo os dados da API e o HTML das páginas, que também traz dados do SSR. */
export async function clearOfflineData() {
    await Promise.allSettled([
        persister?.removeClient(),
        typeof caches !== 'undefined' && deletePageCaches()
    ]);
}
