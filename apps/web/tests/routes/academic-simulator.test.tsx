import { environmentManager } from '@tanstack/react-query';
import { afterEach, expect, test } from 'bun:test';

import { Route } from '#/routes/_app/perfil_.simulador';

import { fakeQueryClient, runLoader } from '../helpers/route';

const wasServer = environmentManager.isServer();
afterEach(() => environmentManager.setIsServer(() => wasServer));

test('no SSR carrega o perfil sem consultar turmas privadas', async () => {
    environmentManager.setIsServer(() => true);
    const keys: unknown[] = [];
    await runLoader(Route, {
        context: {
            queryClient: fakeQueryClient((key) => {
                keys.push(key);
                if (key[1] !== '/me') throw new Error('Consulta privada no SSR');
                return { level: 'Graduação' };
            })
        }
    });
    expect(keys).toEqual([['get', '/me']]);
});

test('no navegador inicia todo o histórico sem esperar pela rede privada', async () => {
    environmentManager.setIsServer(() => false);
    const keys: unknown[] = [];
    await runLoader(Route, {
        context: {
            queryClient: fakeQueryClient((key) => {
                keys.push(key);
                if (key[1] === '/me') return { level: 'Graduação' };
                return new Promise(() => {});
            })
        }
    });
    expect(keys).toContainEqual(['get', '/classrooms', { params: { query: { semester: 'all' } } }]);
});

test.each([
    [null, '/login'],
    [{ level: 'Pós-Graduação' }, '/perfil']
])('redireciona perfil sem acesso (%p)', async (user, to) => {
    const keys: unknown[] = [];
    let error: unknown;
    try {
        await runLoader(Route, {
            context: {
                queryClient: fakeQueryClient((key) => {
                    keys.push(key);
                    return user;
                })
            }
        });
    } catch (caught) {
        error = caught;
    }
    expect(error).toMatchObject({ options: { to } });
    expect(keys).toEqual([['get', '/me']]);
});
