import type { Middleware } from 'openapi-fetch';

import {
    QueryClientProvider,
    environmentManager,
    noop,
    onlineManager
} from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createElement, type ReactNode } from 'react';

import { getContext } from '#/integrations/tanstack-query/root-provider.tsx';
import {
    SessionNotStoredError,
    clearSession,
    startSession,
    useLogin,
    useLogout,
    useSessionRefresh
} from '#/queries/auth.ts';
import { classroomPostsQueryOptions, classroomsQueryOptions } from '#/queries/classrooms.ts';
import { apiClient } from '#/queries/client.ts';
import { ApiError } from '#/queries/errors.ts';
import { meQueryOptions } from '#/queries/me.ts';
import { menuQueryOptions } from '#/queries/restaurant.ts';

import { useDom } from '../helpers/dom';
import { userProfile } from '../helpers/profile';

const user = userProfile();

describe('clearSession', () => {
    const wasServer = environmentManager.isServer();
    beforeEach(() => environmentManager.setIsServer(() => false));
    afterEach(() => {
        environmentManager.setIsServer(() => wasServer);
        Reflect.deleteProperty(globalThis, 'caches');
    });

    test('a promise só resolve depois de apagar o HTML em cache', async () => {
        const deleted: string[] = [];
        Object.defineProperty(globalThis, 'caches', {
            configurable: true,
            value: {
                keys: async () => ['followw-pages-x', 'outro-cache'],
                delete: async (name: string) => {
                    deleted.push(name);
                    return true;
                }
            }
        });
        const { queryClient } = getContext();

        await clearSession(queryClient);

        expect(deleted).toEqual(['followw-pages-x']);
    });

    test('zera o usuário e remove as turmas do cache', async () => {
        const { queryClient } = getContext();
        queryClient.setQueryData(meQueryOptions.queryKey, user);
        queryClient.setQueryData(classroomsQueryOptions.queryKey, []);

        await clearSession(queryClient);

        expect(queryClient.getQueryData(meQueryOptions.queryKey)).toBeNull();
        expect(queryClient.getQueryState(classroomsQueryOptions.queryKey)).toBeUndefined();
    });

    test('remove todos os dados da conta, inclusive os públicos', async () => {
        const { queryClient } = getContext();
        const posts = classroomPostsQueryOptions('turma-1').queryKey;
        const menu = menuQueryOptions({ date: '2026-10-06' }).queryKey;
        queryClient.setQueryData(meQueryOptions.queryKey, user);
        queryClient.setQueryData(posts, []);
        queryClient.setQueryData(menu, []);

        await clearSession(queryClient);

        expect(queryClient.getQueryState(posts)).toBeUndefined();
        expect(queryClient.getQueryState(menu)).toBeUndefined();
    });

    test('remove também queries com chave fora do padrão da API', async () => {
        const { queryClient } = getContext();
        queryClient.setQueryData(['avulsa'], 'dado da conta');

        await clearSession(queryClient);

        expect(queryClient.getQueryState(['avulsa'])).toBeUndefined();
    });

    test('cancela o fetch em andamento das queries da conta', async () => {
        const { queryClient } = getContext();
        let signal: AbortSignal | undefined;
        void queryClient
            .query({
                queryKey: classroomsQueryOptions.queryKey,
                queryFn: (context) => {
                    signal = context.signal;
                    return new Promise(noop);
                }
            })
            .catch(noop);

        await clearSession(queryClient);

        expect(signal?.aborted).toBe(true);
    });

    test('roda quando uma query autenticada volta 401', async () => {
        const { queryClient } = getContext();
        queryClient.setQueryData(meQueryOptions.queryKey, user);

        await queryClient
            .query({
                queryKey: classroomsQueryOptions.queryKey,
                queryFn: () => Promise.reject(new ApiError(401, 'expirada'))
            })
            .catch(noop);

        expect(queryClient.getQueryData(meQueryOptions.queryKey)).toBeNull();
    });

    test('mantém a sessão em erros que não são 401', async () => {
        const { queryClient } = getContext();
        queryClient.setQueryData(meQueryOptions.queryKey, user);

        await queryClient
            .query({
                queryKey: classroomsQueryOptions.queryKey,
                queryFn: () => Promise.reject(new ApiError(404, 'não achou')),
                retry: false
            })
            .catch(noop);

        expect(queryClient.getQueryData(meQueryOptions.queryKey)).not.toBeNull();
    });
});

describe('startSession', () => {
    let middleware: Middleware | undefined;

    // devolve o corpo, ou falha como o errorHandlingMiddleware faria
    function respond(response: () => Response | ApiError) {
        middleware = {
            onRequest: () => {
                const result = response();
                if (result instanceof ApiError) throw result;
                return result;
            }
        };
        apiClient.use(middleware);
    }

    afterEach(() => {
        if (middleware) apiClient.eject(middleware);
    });

    test('busca o perfil de novo mesmo com o /me nulo em cache', async () => {
        const { queryClient } = getContext();
        queryClient.setQueryData(meQueryOptions.queryKey, null);
        respond(() => Response.json(user));

        expect(await startSession(queryClient)).toEqual(user);
        expect(queryClient.getQueryData(meQueryOptions.queryKey)).toEqual(user);
    });

    test('não reaproveita um /me que saiu antes dos cookies do login', async () => {
        const { queryClient } = getContext();
        let release: () => void = noop;
        let markStarted: () => void = noop;
        const started = new Promise<void>((resolve) => (markStarted = resolve));
        let calls = 0;
        middleware = {
            onRequest: async () => {
                calls += 1;
                if (calls > 1) {
                    release();
                    return Response.json(user);
                }
                markStarted();
                await new Promise<void>((resolve) => {
                    release = resolve;
                    setTimeout(resolve, 100);
                });
                throw new ApiError(401, 'Not authenticated');
            }
        };
        apiClient.use(middleware);

        // ex.: refetch ao voltar o foco enquanto o POST do login ainda não respondeu
        const stale = queryClient.query({ ...meQueryOptions, staleTime: 0 }).catch(noop);
        await started;

        expect(await startSession(queryClient)).toEqual(user);
        await stale;
        expect(queryClient.getQueryData(meQueryOptions.queryKey)).toEqual(user);
    });

    test('falha se o /me logo após o login ainda vier sem sessão', async () => {
        const { queryClient } = getContext();
        respond(() => new ApiError(401, 'Not authenticated'));

        const error = await startSession(queryClient).catch((reason: unknown) => reason);
        expect(error).toBeInstanceOf(SessionNotStoredError);
    });

    test('repassa a falha do SIGAA em vez de seguir deslogado', async () => {
        const { queryClient } = getContext();
        respond(() => new ApiError(502, 'SIGAA is unavailable'));

        const error = await startSession(queryClient).catch((reason: unknown) => reason);
        expect(error).toMatchObject({ status: 502 });
    });
});

describe('hooks de sessão', () => {
    const dom = useDom();
    let middleware: Middleware;
    let requests: Request[];
    let response: () => Response | ApiError;

    beforeEach(() => {
        requests = [];
        response = () => Response.json(null);
        middleware = {
            onRequest: ({ request }) => {
                requests.push(request);
                const result = response();
                if (result instanceof ApiError) throw result;
                return result;
            }
        };
        apiClient.use(middleware);
    });

    afterEach(() => {
        dom.testing.cleanup();
        apiClient.eject(middleware);
        onlineManager.setOnline(true);
    });

    function renderHook<T>(hook: () => T, registration = user.registration) {
        const { queryClient } = getContext();
        const account: typeof user = { ...user, registration };
        queryClient.setQueryData(meQueryOptions.queryKey, account);
        const wrapper = ({ children }: { children: ReactNode }) =>
            createElement(QueryClientProvider, { client: queryClient }, children);
        return { queryClient, ...dom.testing.renderHook(hook, { wrapper }) };
    }

    const paths = () => requests.map((r) => `${r.method} ${new URL(r.url).pathname}`);

    test('logout encerra na API, limpa a conta e avisa quem chamou', async () => {
        let saiu = false;
        const { result, queryClient } = renderHook(() => useLogout(() => (saiu = true)));
        queryClient.setQueryData(classroomsQueryOptions.queryKey, []);

        await dom.testing.act(() => result.current.mutateAsync({}));

        expect(paths()).toEqual(['DELETE /api/auth/sigaa']);
        expect(queryClient.getQueryData(meQueryOptions.queryKey)).toBeNull();
        expect(queryClient.getQueryState(classroomsQueryOptions.queryKey)).toBeUndefined();
        expect(saiu).toBe(true);
    });

    test('logout que falha mantém a sessão', async () => {
        response = () => new ApiError(502, 'SIGAA is unavailable');
        const { result, queryClient } = renderHook(() => useLogout());

        await dom.testing.act(() => result.current.mutateAsync({}).catch(noop));

        expect(queryClient.getQueryData(meQueryOptions.queryKey)).not.toBeNull();
    });

    test('senha incorreta não apaga a conta nem o cache existente', async () => {
        response = () => new ApiError(401, 'Senha incorreta');
        const { result, queryClient } = renderHook(() => useLogin());
        queryClient.setQueryData(classroomsQueryOptions.queryKey, []);

        await dom.testing.act(() =>
            result.current
                .mutateAsync({ body: { registration: user.registration, password: 'errada' } })
                .catch(noop)
        );

        expect(queryClient.getQueryData(meQueryOptions.queryKey)).toEqual(user);
        expect(queryClient.getQueryData(classroomsQueryOptions.queryKey)).toEqual([]);
    });

    test('perfil que expira avisa as outras abas mesmo depois de receber null', async () => {
        const { queryClient } = getContext();
        queryClient.setQueryData(meQueryOptions.queryKey, user);
        const before = Number(window.localStorage.getItem('followw:session-version') ?? 0);
        response = () => new ApiError(401, 'Expirada');
        expect(await queryClient.query({ ...meQueryOptions, staleTime: 0 })).toBeNull();
        expect(Number(window.localStorage.getItem('followw:session-version'))).toBe(before + 1);
        queryClient.clear();
    });

    test('cancela consultas antes de enviar o logout', async () => {
        const { result, queryClient } = renderHook(() => useLogout());
        let signal: AbortSignal | undefined;
        void queryClient
            .query({
                queryKey: classroomsQueryOptions.queryKey,
                queryFn: (context) => {
                    signal = context.signal;
                    return new Promise(noop);
                }
            })
            .catch(noop);
        response = () => {
            expect(signal?.aborted).toBe(true);
            return Response.json(null);
        };
        await dom.testing.act(() => result.current.mutateAsync({}));
    });

    test('limpar a sessão permite renovar a mesma matrícula novamente', async () => {
        const first = renderHook(() => useSessionRefresh(), '251000009');
        await dom.testing.waitFor(() => expect(requests).toHaveLength(1));
        first.unmount();
        await clearSession(first.queryClient);
        renderHook(() => useSessionRefresh(), '251000009');
        await dom.testing.waitFor(() => expect(requests).toHaveLength(2));
        expect(paths()).toEqual(['POST /api/auth/sigaa/refresh', 'POST /api/auth/sigaa/refresh']);
    });

    test('login que aborta a renovação permite renovar a mesma conta novamente', async () => {
        const gate = Promise.withResolvers<void>();
        middleware.onRequest = async ({ request }) => {
            requests.push(request);
            if (new URL(request.url).pathname.endsWith('/refresh') && requests.length === 1) {
                await gate.promise;
                expect(request.signal.aborted).toBe(true);
                throw new DOMException('Cancelada', 'AbortError');
            }
            if (new URL(request.url).pathname === '/api/auth/sigaa')
                throw new ApiError(401, 'Senha incorreta');
            return Response.json(null);
        };
        const first = renderHook(() => useSessionRefresh(), '251000010');
        await dom.testing.waitFor(() => expect(requests).toHaveLength(1));
        first.unmount();
        const login = renderHook(() => useLogin(), '251000010');
        await dom.testing.act(() =>
            login.result.current
                .mutateAsync({
                    body: { registration: '251000010', password: 'errada' }
                })
                .catch(noop)
        );
        gate.resolve();
        renderHook(() => useSessionRefresh(), '251000010');
        await dom.testing.waitFor(() => expect(requests).toHaveLength(3));
        expect(paths()).toEqual([
            'POST /api/auth/sigaa/refresh',
            'POST /api/auth/sigaa',
            'POST /api/auth/sigaa/refresh'
        ]);
    });

    // a renovação é lembrada por matrícula no módulo: cada teste usa uma
    test('renova a sessão uma vez por matrícula', async () => {
        const { rerender, unmount } = renderHook(() => useSessionRefresh(), '251000001');
        rerender();
        unmount();
        renderHook(() => useSessionRefresh(), '251000001');

        await dom.testing.waitFor(() => expect(requests).toHaveLength(1));
        expect(paths()).toEqual(['POST /api/auth/sigaa/refresh']);
    });

    test('renovação recusada encerra a sessão local', async () => {
        response = () => new ApiError(401, 'Invalid credentials');
        const { queryClient } = renderHook(() => useSessionRefresh(), '251000002');

        await dom.testing.waitFor(() =>
            expect(queryClient.getQueryData(meQueryOptions.queryKey)).toBeNull()
        );
    });

    test('renovação que falha por outro motivo mantém a sessão', async () => {
        response = () => new ApiError(502, 'SIGAA is unavailable');
        const { queryClient } = renderHook(() => useSessionRefresh(), '251000003');

        await dom.testing.waitFor(() => expect(requests).toHaveLength(1));
        await Promise.resolve();
        expect(queryClient.getQueryData(meQueryOptions.queryKey)).not.toBeNull();
    });

    test('offline não tenta renovar', () => {
        onlineManager.setOnline(false);
        renderHook(() => useSessionRefresh(), '251000004');

        expect(requests).toHaveLength(0);
    });
});
