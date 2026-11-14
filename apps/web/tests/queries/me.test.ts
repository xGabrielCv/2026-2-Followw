import type { Middleware } from 'openapi-fetch';

import { QueryClient, environmentManager, noop } from '@tanstack/react-query';
import * as StartServer from '@tanstack/react-start/server';
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import { getContext } from '#/integrations/tanstack-query/root-provider';
import { apiClient } from '#/queries/client';
import { ApiError } from '#/queries/errors';
import { meQueryOptions, seedAnonymousProfile } from '#/queries/me';

import { userProfile } from '../helpers/profile';

describe('usuário logado', () => {
    let middleware: Middleware;
    let response: () => Response | Error;
    let client: QueryClient;

    beforeEach(() => {
        middleware = {
            onRequest: () => {
                const result = response();
                if (result instanceof Error) throw result;
                return result;
            }
        };
        apiClient.use(middleware);
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    });

    afterEach(() => {
        client.clear();
        apiClient.eject(middleware);
    });

    test('devolve o perfil da API', async () => {
        response = () => Response.json(userProfile());

        expect(await client.query(meQueryOptions)).toMatchObject({ registration: '251000000' });
    });

    test('sem sessão resolve null em vez de erro', async () => {
        response = () => new ApiError(401, 'Not authenticated');

        expect(await client.query(meQueryOptions)).toBeNull();
    });

    test.each([401, 200])(
        'resposta %s sem perfil apaga os dados da conta anterior',
        async (status) => {
            const wasServer = environmentManager.isServer();
            environmentManager.setIsServer(() => false);
            client = getContext().queryClient;
            environmentManager.setIsServer(() => wasServer);
            client.setQueryData(meQueryOptions.queryKey, userProfile());
            client.setQueryData(['get', '/classrooms'], ['privado']);
            let deleted = 0;
            Object.defineProperty(globalThis, 'caches', {
                configurable: true,
                value: {
                    keys: async () => ['followw-pages-anterior'],
                    delete: async () => {
                        deleted++;
                        return true;
                    }
                }
            });
            response = () => (status === 401 ? new ApiError(401, 'Expirada') : Response.json(null));
            try {
                expect(await client.query({ ...meQueryOptions, staleTime: 0 })).toBeNull();
                expect(client.getQueryData(['get', '/classrooms'])).toBeUndefined();
                await Bun.sleep(0);
                expect(deleted).toBe(1);
            } finally {
                Reflect.deleteProperty(globalThis, 'caches');
            }
        }
    );

    test.each([new TypeError('offline'), new ApiError(502, 'Indisponível')])(
        'falha de atualização mantém o perfil e os dados anteriores: %p',
        async (failure) => {
            const profile = userProfile();
            client.setQueryData(meQueryOptions.queryKey, profile);
            client.setQueryData(['get', '/classrooms'], ['salvo']);
            response = () => failure;
            await client.query({ ...meQueryOptions, staleTime: 0 }).catch(noop);
            expect(client.getQueryData(meQueryOptions.queryKey)).toEqual(profile);
            expect(client.getQueryData(['get', '/classrooms'])).toEqual(['salvo']);
        }
    );

    test.each([new ApiError(502, 'SIGAA is unavailable'), new TypeError('Failed to fetch')])(
        'falha %p não é confundida com deslogado',
        async (error) => {
            response = () => error;

            let reason: unknown;
            try {
                await client.query(meQueryOptions);
            } catch (caught) {
                reason = caught;
            }

            expect(reason).toBe(error);
        }
    );
});

describe('perfil no SSR', () => {
    test('consulta o cookie de cada requisição sem compartilhar o perfil', async () => {
        let current = new Request('http://localhost/', { headers: { cookie: 'outro=1' } });
        const request = spyOn(StartServer, 'getRequest').mockImplementation(() => current);
        const cookie = spyOn(StartServer, 'getCookie').mockImplementation(
            (name) =>
                current.headers
                    .get('cookie')
                    ?.split('; ')
                    .find((part) => part.startsWith(`${name}=`))
                    ?.split('=')[1]
        );
        let calls = 0;
        const middleware: Middleware = {
            onRequest: () => {
                calls++;
                return Response.json(userProfile({ registration: 'conta-autenticada' }));
            }
        };
        apiClient.use(middleware);
        const anonymous = new QueryClient();
        const authenticated = new QueryClient();
        try {
            await seedAnonymousProfile(anonymous);
            expect(anonymous.getQueryData(meQueryOptions.queryKey)).toBeNull();
            expect(await anonymous.query({ ...meQueryOptions, staleTime: 0 })).toBeNull();
            expect(calls).toBe(0);
            current = new Request('http://localhost/', {
                headers: { cookie: 'refresh_token=sintetico' }
            });
            await seedAnonymousProfile(authenticated);
            expect(authenticated.getQueryData(meQueryOptions.queryKey)).toBeUndefined();
            expect(await authenticated.query(meQueryOptions)).toMatchObject({
                registration: 'conta-autenticada'
            });
            expect(calls).toBe(1);
            current = new Request('http://localhost/');
            expect(await authenticated.query({ ...meQueryOptions, staleTime: 0 })).toBeNull();
            expect(calls).toBe(1);
        } finally {
            anonymous.clear();
            authenticated.clear();
            apiClient.eject(middleware);
            request.mockRestore();
            cookie.mockRestore();
        }
    });
});
