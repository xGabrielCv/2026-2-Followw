import type { Middleware } from 'openapi-fetch';

import {
    QueryClient,
    QueryClientProvider,
    dehydrate,
    environmentManager,
    hydrate,
    noop
} from '@tanstack/react-query';
import { type PersistedClient } from '@tanstack/react-query-persist-client';
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import * as idb from 'idb-keyval';
import { createElement, type ReactNode } from 'react';

import { pagesCacheName } from '#/integrations/offline/pages-cache';
import {
    clearOfflineData,
    encryptedQueryPersister,
    persistQueryCache,
    localRetentionMs,
    shouldPersistQuery,
    warmPages
} from '#/integrations/offline/storage';
import { getContext } from '#/integrations/tanstack-query/root-provider';
import { openLocal } from '#/lib/local-vault';
import { useLogout } from '#/queries/auth';
import { apiClient } from '#/queries/client';
import { ApiError } from '#/queries/errors';
import { meQueryOptions } from '#/queries/me';

import { useDom } from '../../helpers/dom';
import { userProfile } from '../../helpers/profile';

// sem o define do vite, o build é 'dev'
const current = pagesCacheName('dev');

// Cache Storage mínimo
class FakeCache {
    entries = new Map<string, Response>();
    match = async (url: string) => this.entries.get(url);
    delete = async (url: string) => this.entries.delete(url);
    put = async (url: string, response: Response) => {
        this.entries.set(url, response);
    };
}

function redirected() {
    const response = new Response('login');
    Object.defineProperty(response, 'redirected', { value: true });
    return response;
}

const realFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

describe('cache de páginas offline', () => {
    let stores: Map<string, FakeCache>;
    let pages: Record<string, Response | undefined>;
    const cached = () => [...(stores.get(current)?.entries.keys() ?? [])].toSorted();

    beforeEach(() => {
        stores = new Map();
        pages = {};
        // `pages` define a resposta de cada URL; sem entrada, a rede falha
        Object.defineProperty(globalThis, 'fetch', {
            configurable: true,
            writable: true,
            value: async (url: string) => {
                const response = pages[url];
                if (!response) throw new TypeError('offline');
                return response;
            }
        });
        Object.defineProperty(globalThis, 'caches', {
            configurable: true,
            value: {
                keys: async () => [...stores.keys()],
                delete: async (name: string) => stores.delete(name),
                open: async (name: string) => {
                    if (!stores.has(name)) stores.set(name, new FakeCache());
                    return stores.get(name);
                }
            }
        });
    });

    afterEach(() => {
        if (realFetch) Object.defineProperty(globalThis, 'fetch', realFetch);
        Reflect.deleteProperty(globalThis, 'caches');
    });

    test('guarda as páginas principais conforme o login', async () => {
        for (const url of ['/', '/ru', '/turmas', '/perfil', '/login'])
            pages[url] = new Response(url);

        await warmPages(true);
        expect(cached()).toEqual(['/', '/login', '/ru', '/turmas']);

        stores.clear();
        await warmPages(false);
        expect(cached()).toEqual(['/', '/login', '/ru', '/turmas']);
    });

    test('falha parcial preserva o cache anterior até completar a nova versão', async () => {
        const home = new Response('home');
        stores.set('followw-pages-antigo', new FakeCache());
        stores.set('outro-cache', new FakeCache());
        stores.set(current, new FakeCache());
        stores.get(current)?.entries.set('/', home);
        pages['/'] = new Response('nova home');
        pages['/ru'] = new Response('ru');

        await warmPages(true);

        expect([...stores.keys()].toSorted()).toEqual(
            [current, 'outro-cache', 'followw-pages-antigo'].toSorted()
        );
        expect(stores.get(current)?.entries.get('/')).toBe(home);
        // falha de rede numa página não impede as outras
        expect(cached()).toEqual(['/', '/ru']);
    });

    test('duas solicitações simultâneas compartilham o aquecimento', async () => {
        let calls = 0;
        const gate = Promise.withResolvers<void>();
        Object.defineProperty(globalThis, 'fetch', {
            configurable: true,
            value: async () => {
                calls++;
                await gate.promise;
                return new Response('shell público');
            }
        });
        const first = warmPages(true);
        const second = warmPages(true);
        gate.resolve();
        await Promise.all([first, second]);
        expect(calls).toBe(4);
    });

    test('o cache de páginas é versionado por build', () => {
        expect(pagesCacheName('abc')).toBe('followw-pages-abc');
    });

    test('descarta respostas redirecionadas e com erro', async () => {
        pages['/perfil'] = redirected();
        pages['/ru'] = new Response('erro', { status: 500 });
        pages['/turmas'] = new Response('turmas');

        await warmPages(true);

        expect(cached()).toEqual(['/turmas']);
    });

    test('clearOfflineData apaga todas as páginas guardadas', async () => {
        stores.set(current, new FakeCache());
        stores.set('outro-cache', new FakeCache());
        await clearOfflineData();
        expect([...stores.keys()]).toEqual(['outro-cache']);
    });

    test('clearOfflineData não quebra sem Cache Storage (SSR)', async () => {
        Reflect.deleteProperty(globalThis, 'caches');
        await clearOfflineData();
    });
});

const queryAt = (updatedAt: number) => {
    const client = new QueryClient();
    client.setQueryData(['dado'], 1, { updatedAt });
    return client.getQueryCache().find({ queryKey: ['dado'] })!;
};

describe('shouldPersistQuery', () => {
    const now = Date.parse('2026-10-10T12:00:00Z');

    test('salva a query atualizada dentro da validade', () => {
        expect(shouldPersistQuery(queryAt(now - localRetentionMs() + 1), now)).toBe(true);
    });

    test('descarta a query sem atualização há mais que a validade', () => {
        expect(shouldPersistQuery(queryAt(now - localRetentionMs()), now)).toBe(false);
    });

    test('mantém o último dado válido quando a atualização falha', async () => {
        const query = queryAt(now - 1000);
        query.setState({ status: 'error', error: new Error('offline') });
        expect(shouldPersistQuery(query, now)).toBe(true);
    });

    test('não salva recomendações mesmo com dado válido', () => {
        const client = new QueryClient();
        const key = ['get', '/public/subjects'];
        client.setQueryData(key, { items: [] }, { updatedAt: now });
        expect(shouldPersistQuery(client.getQueryCache().find({ queryKey: key })!, now)).toBe(
            false
        );
        client.clear();
    });

    test('nunca salva chamados de suporte: a chave secreta está nos parâmetros', () => {
        const client = new QueryClient();
        const key = [
            'get',
            '/support/tickets/{ticket_id}',
            { params: { header: { 'X-Ticket-Key': 'segredo' } } }
        ];
        client.setQueryData(key, { ok: true }, { updatedAt: now });
        expect(shouldPersistQuery(client.getQueryCache().find({ queryKey: key })!, now)).toBe(
            false
        );
    });

    test('não salva query sem dado', () => {
        const client = new QueryClient();
        client.getQueryCache().build(client, { queryKey: ['vazia'] });
        const query = client.getQueryCache().find({ queryKey: ['vazia'] })!;
        expect(shouldPersistQuery(query, now)).toBe(false);
    });
});

describe('persistência cifrada após atualização', () => {
    const values = new Map<IDBValidKey, unknown>();
    let restoreMocks: () => void;
    let afterWrite: (key: IDBValidKey) => void;
    let afterDelete: (key: IDBValidKey) => void;
    const clients: QueryClient[] = [];

    beforeEach(async () => {
        values.clear();
        afterWrite = noop;
        afterDelete = noop;
        values.set(
            'followw-device-key-v1',
            await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
                'encrypt',
                'decrypt'
            ])
        );
        const get = spyOn(idb, 'get').mockImplementation(async <T>(key: IDBValidKey) => {
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dublê do contrato genérico do IndexedDB
            return values.get(key) as T | undefined;
        });
        const set = spyOn(idb, 'set').mockImplementation(async (key, value) => {
            values.set(key, value);
            afterWrite(key);
        });
        const del = spyOn(idb, 'del').mockImplementation(async (key) => {
            values.delete(key);
            afterDelete(key);
        });
        restoreMocks = () => {
            get.mockRestore();
            set.mockRestore();
            del.mockRestore();
        };
    });

    afterEach(() => {
        restoreMocks();
        for (const item of clients.splice(0)) item.clear();
    });

    function client() {
        const result = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        clients.push(result);
        return result;
    }

    test('401 no perfil elimina a cópia cifrada que permitiria restaurar a conta offline', async () => {
        const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
        Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {} });
        const wasServer = environmentManager.isServer();
        environmentManager.setIsServer(() => false);
        const active = getContext().queryClient;
        environmentManager.setIsServer(() => wasServer);
        clients.push(active);
        active.setQueryData(meQueryOptions.queryKey, userProfile({ registration: 'conta-a' }));
        active.setQueryData(['get', '/classrooms'], ['privado']);
        const saved = Promise.withResolvers<void>();
        const deleted = Promise.withResolvers<void>();
        afterWrite = (key) => {
            if (key === 'followw-query-cache') saved.resolve();
        };
        afterDelete = (key) => {
            if (key === 'followw-query-cache') deleted.resolve();
        };
        const middleware: Middleware = {
            onRequest: () => {
                throw new ApiError(401, 'Expirada');
            }
        };
        apiClient.use(middleware);
        let stop: () => void = noop;
        try {
            stop = persistQueryCache(active);
            await saved.promise;
            expect(values.has('followw-query-cache')).toBe(true);
            expect(await active.query({ ...meQueryOptions, staleTime: 0 })).toBeNull();
            await deleted.promise;
            expect(values.has('followw-query-cache')).toBe(false);
            expect(active.getQueryData(['get', '/classrooms'])).toBeUndefined();
            const offline = await encryptedQueryPersister().restoreClient();
            expect(JSON.stringify(offline ?? null)).not.toContain('conta-a');
            expect(JSON.stringify(offline ?? null)).not.toContain('privado');
        } finally {
            stop();
            apiClient.eject(middleware);
            if (previous) Object.defineProperty(globalThis, 'indexedDB', previous);
            else Reflect.deleteProperty(globalThis, 'indexedDB');
        }
    });

    test('restaura o último sucesso sem alterar o erro em memória nem a data original', async () => {
        const original = client();
        const key = ['get', '/classrooms'];
        const updatedAt = Date.now() - 1000;
        original.setQueryData(meQueryOptions.queryKey, userProfile({ registration: 'conta-a' }));
        original.setQueryData(key, ['último sucesso'], { updatedAt });
        await original
            .query({
                queryKey: key,
                staleTime: 0,
                queryFn: () => {
                    throw new Error('offline');
                }
            })
            .catch(() => {});
        original.setQueryData(['get', '/support/tickets'], ['segredo']);
        original.setQueryData(['get', '/public/subjects'], ['recomendação']);
        original.getMutationCache().build(original, { mutationKey: ['pendente'] });
        const snapshot: PersistedClient = {
            timestamp: Date.now(),
            buster: 'dev:0',
            clientState: dehydrate(original, {
                shouldDehydrateQuery: shouldPersistQuery,
                shouldDehydrateMutation: () => false
            })
        };
        const persister = encryptedQueryPersister(() => 'conta-a');
        await persister.persistClient(snapshot);
        expect(original.getQueryState(key)?.status).toBe('error');
        expect(
            snapshot.clientState.queries.find((query) => query.queryKey[1] === '/classrooms')?.state
                .status
        ).toBe('error');
        const sealed = values.get('followw-query-cache');
        expect(typeof sealed).toBe('string');
        expect(String(sealed)).not.toContain('último sucesso');
        const restored = await persister.restoreClient();
        if (!restored) throw new Error('O cache cifrado deveria ter sido restaurado');
        expect(restored?.clientState.mutations).toEqual([]);
        expect(restored?.clientState.queries.map((query) => query.queryKey[1])).toEqual([
            '/me',
            '/classrooms'
        ]);
        const reopened = client();
        hydrate(reopened, restored.clientState);
        expect(reopened.getQueryData(key)).toEqual(['último sucesso']);
        expect(reopened.getQueryState(key)).toMatchObject({
            status: 'success',
            error: null,
            fetchStatus: 'idle',
            dataUpdatedAt: updatedAt
        });
    });

    test('salva o dado já hidratado depois de restaurar sem esperar nova consulta', async () => {
        const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
        Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {} });
        const hydrated = client();
        hydrated.setQueryData(['get', '/public/config'], { ready: true });
        let stop: () => void = noop;
        const saved = Promise.withResolvers<void>();
        afterWrite = (key) => {
            if (key === 'followw-public-query-cache') saved.resolve();
        };
        try {
            await new Promise<void>((resolve) => {
                stop = persistQueryCache(hydrated, resolve);
            });
            await saved.promise;
            const sealed = values.get('followw-public-query-cache');
            expect(typeof sealed).toBe('string');
            expect(await openLocal(String(sealed), 'query-cache')).toMatchObject({
                clientState: {
                    mutations: [],
                    queries: [
                        { queryKey: ['get', '/public/config'], state: { data: { ready: true } } }
                    ]
                }
            });
        } finally {
            stop();
            if (previous) Object.defineProperty(globalThis, 'indexedDB', previous);
            else Reflect.deleteProperty(globalThis, 'indexedDB');
        }
    });
    describe('ordem do callback de logout', () => {
        const dom = useDom();

        test('avisa o logout antes de terminar a exclusão no IndexedDB e aguarda a limpeza', async () => {
            const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
            Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {} });
            const active = getContext().queryClient;
            clients.push(active);
            active.setQueryData(meQueryOptions.queryKey, userProfile());
            const saved = Promise.withResolvers<void>();
            const deleting = Promise.withResolvers<void>();
            const release = Promise.withResolvers<void>();
            afterWrite = (key) => {
                if (key === 'followw-query-cache') saved.resolve();
            };
            let deletionFinished = false;
            spyOn(idb, 'del').mockImplementation(async (key) => {
                if (key === 'followw-query-cache') {
                    deleting.resolve();
                    await release.promise;
                    deletionFinished = true;
                }
                values.delete(key);
            });
            const middleware: Middleware = { onRequest: () => Response.json(null) };
            apiClient.use(middleware);
            let notifications = 0;
            const wrapper = ({ children }: { children: ReactNode }) =>
                createElement(QueryClientProvider, { client: active }, children);
            const { result } = dom.testing.renderHook(
                () =>
                    useLogout(() => {
                        notifications++;
                    }),
                { wrapper }
            );
            const stop = persistQueryCache(active);
            try {
                await saved.promise;
                stop();
                await dom.testing.act(async () => {
                    let settled = false;
                    const logout = result.current.mutateAsync({}).then(() => {
                        settled = true;
                        return undefined;
                    });
                    try {
                        await deleting.promise;
                        expect(active.getQueryData(meQueryOptions.queryKey)).toBeNull();
                        expect(deletionFinished).toBe(false);
                        expect(notifications).toBe(1);
                        expect(settled).toBe(false);
                    } finally {
                        release.resolve();
                        await logout;
                    }
                });
                expect(deletionFinished).toBe(true);
                expect(notifications).toBe(1);
            } finally {
                release.resolve();
                stop();
                dom.testing.cleanup();
                apiClient.eject(middleware);
                if (previous) Object.defineProperty(globalThis, 'indexedDB', previous);
                else Reflect.deleteProperty(globalThis, 'indexedDB');
            }
        });
    });
});

describe('restauração do cache', () => {
    test('avisa quando termina de restaurar', () => {
        let restored = 0;
        persistQueryCache(new QueryClient(), () => restored++);
        expect(restored).toBe(1);
    });
});
