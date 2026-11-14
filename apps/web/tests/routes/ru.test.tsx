import * as baseUILayout from '@base-ui/utils/useIsoLayoutEffect';
import { QueryClient, QueryClientProvider, environmentManager } from '@tanstack/react-query';
import {
    Outlet,
    RouterProvider,
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter
} from '@tanstack/react-router';
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { useLayoutEffect } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { UserProfile } from '#/queries/me';

import { PageStateProvider } from '#/components/PageState';
import { meQueryOptions } from '#/queries/me';
import { menuQueryOptions } from '#/queries/restaurant';
import { credentialsQueryOptions, statementQueryOptions } from '#/queries/restaurant-account';

import { useDom } from '../helpers/dom';
import { userProfile } from '../helpers/profile';
import { callRoute, fakeQueryClient, runLoader } from '../helpers/route';

const dom = useDom();
let Route: typeof import('#/routes/_app/ru').Route;
let restoreLayoutEffect: () => Promise<void>;
beforeAll(async () => {
    // A importação SSR anterior ao DOM deixa este hook vazio no cache do Bun.
    const previous = baseUILayout.useIsoLayoutEffect;
    await mock.module('@base-ui/utils/useIsoLayoutEffect', () => ({
        useIsoLayoutEffect: useLayoutEffect
    }));
    restoreLayoutEffect = async () => {
        await mock.module('@base-ui/utils/useIsoLayoutEffect', () => ({
            useIsoLayoutEffect: previous
        }));
    };
    ({ Route } = await import('#/routes/_app/ru'));
});
afterAll(() => restoreLayoutEffect());

function contextWith(
    user: {
        registration: string;
        unit?: { id: number; code: string | null; name: string };
    } | null,
    failingPath?: string
) {
    const paths: unknown[] = [];
    const queries: unknown[] = [];
    return {
        paths,
        queries,
        location: { searchStr: '' },
        context: {
            queryClient: fakeQueryClient((queryKey) => {
                const path = queryKey[1];
                paths.push(path);
                queries.push(queryKey[2]);
                if (path === failingPath) throw new Error('SIGAA indisponível');
                return path === '/me' ? user : [];
            })
        }
    };
}

describe('loader do RU', () => {
    test('trocar dia, refeição ou campus na página não roda o loader de novo', () => {
        expect(callRoute(Route.options.shouldReload, { cause: 'stay' })).toBe(false);
        expect(callRoute(Route.options.shouldReload, { cause: 'enter' })).toBe(true);
    });

    test('carrega o dia e o campus do link e mantém a refeição compartilhada', async () => {
        const context = contextWith({
            registration: '251000000',
            unit: { id: 672, code: 'FCTS', name: 'CAMPUS UNB CEILÂNDIA' }
        });
        const data = await runLoader(Route, {
            ...context,
            location: { searchStr: '?date=2026-10-25&meal=dinner&campus=Gama' }
        });
        expect(data.defaultCampus).toBe('Ceilandia');
        expect(data.defaultDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(context.queries[1]).toMatchObject({
            params: { query: { campus: 'Gama', start_date: '2026-10-19', end_date: '2026-10-25' } }
        });
    });
    test('visitantes consultam apenas perfil e cardápio público', async () => {
        const context = contextWith(null);
        const data = await runLoader(Route, context);
        expect(context.paths).toEqual(['/me', '/public/restaurant']);
        expect(data.defaultDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(['breakfast', 'lunch', 'dinner']).toContain(data.defaultMeal);
    });

    test('no SSR não consulta a conta, que fica para o cache do navegador', async () => {
        const context = contextWith({ registration: '251000000' });
        await runLoader(Route, context);
        expect(context.paths).toEqual(['/me', '/public/restaurant']);
    });

    test('carrega o cardápio autenticado sem iniciar saldo e carteirinha no loader', async () => {
        const context = contextWith({ registration: '251000000' }, '/me/ru-token');
        environmentManager.setIsServer(() => false);
        const data = await runLoader(Route, context).finally(() =>
            environmentManager.setIsServer(() => true)
        );
        expect(context.paths).toEqual(['/me', '/public/restaurant']);
        expect(data).toHaveProperty('defaultMeal');
    });
});

test('consome o pedido após montar a conta lazy e preserva histórico e filtros sem reabrir', async () => {
    environmentManager.setIsServer(() => false);
    const registration = '251000000';
    const loaded = await runLoader(Route, contextWith({ registration }));
    const client = new QueryClient({
        defaultOptions: { queries: { enabled: false, retry: false, staleTime: Infinity } }
    });
    client.setQueryData<UserProfile | null>(meQueryOptions.queryKey, userProfile({ registration }));
    client.setQueryData(
        menuQueryOptions({ date: loaded.defaultDate, campus: 'Gama' }).queryKey,
        []
    );
    const Page = Route.options.component;
    if (!Page) throw new Error('Página do RU ausente');
    const root = createRootRoute();
    const app = createRoute({
        getParentRoute: () => root,
        id: '_app',
        component: () => (
            <PageStateProvider page="/ru">
                <Outlet />
            </PageStateProvider>
        )
    });
    const ru = createRoute({
        getParentRoute: () => app,
        path: 'ru',
        validateSearch: Route.options.validateSearch,
        loader: () => loaded,
        component: Page
    });
    const history = createMemoryHistory({ initialEntries: ['/ru?campus=Gama'] });
    const retained = { returnTo: '/perfil', filters: { campus: 'Gama' } };
    history.replace('/ru?campus=Gama', { studentCard: true, ...retained });
    const router = createRouter({
        routeTree: root.addChildren([app.addChildren([ru])]),
        history,
        isServer: false,
        origin: 'http://localhost'
    });
    await router.load();
    expect(history.location.state.studentCard).toBe(true);
    const { render, waitFor, act, fireEvent } = dom.testing;
    const view = render(
        <QueryClientProvider client={client}>
            <NuqsTestingAdapter searchParams="?campus=Gama">
                <RouterProvider router={router} />
            </NuqsTestingAdapter>
        </QueryClientProvider>
    );
    const trigger = () => view.getByLabelText('Ver QR code da carteirinha');
    // O chunk lazy ainda não recebeu o pedido nesta renderização.
    expect(view.queryByLabelText('Ver QR code da carteirinha')).toBeNull();
    expect(history.location.state.studentCard).toBe(true);
    await waitFor(() => {
        expect(trigger().getAttribute('aria-expanded')).toBe('true');
        expect(history.location.state.studentCard).toBeUndefined();
    });
    expect(history.location.state).toMatchObject(retained);
    expect(history.location.search).toBe('?campus=Gama');
    expect(history.length).toBe(1);

    await act(async () => {
        client.setQueryData(statementQueryOptions(registration).queryKey, {
            balance: '12.50',
            group: 2,
            entries: []
        });
    });
    await waitFor(() => {
        expect(view.getByText('Saldo disponível')).toBeDefined();
        expect(trigger().getAttribute('aria-expanded')).toBe('true');
    });
    fireEvent.click(view.getByText('Fechar'));
    await waitFor(() => expect(trigger().getAttribute('aria-expanded')).toBe('false'));
    await act(async () => {
        client.setQueryData(credentialsQueryOptions(registration).queryKey, {
            token: 'carteirinha-token',
            valid_until: '2099-10-01'
        });
    });
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(history.location.state).toMatchObject(retained);
    view.unmount();
    client.clear();
});

test('header do RU renderiza enquanto o loader ainda carrega', async () => {
    const Header = Route.options.staticData?.header;
    if (!Header) throw new Error('Header do RU ausente');
    const root = createRootRoute();
    const app = createRoute({
        getParentRoute: () => root,
        id: '_app',
        component: () => (
            <PageStateProvider page="/ru">
                <Header />
                <Outlet />
            </PageStateProvider>
        )
    });
    const ru = createRoute({
        getParentRoute: () => app,
        path: 'ru',
        loader: () => new Promise<never>(() => {})
    });
    const router = createRouter({
        routeTree: root.addChildren([app.addChildren([ru])]),
        history: createMemoryHistory({ initialEntries: ['/ru'] }),
        isServer: false,
        origin: 'http://localhost',
        defaultPendingMs: 0,
        defaultPendingComponent: () => null
    });
    void router.load();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const match = router.state.matches.at(-1);
    expect(match?.status).toBe('pending');
    expect(match?.loaderData).toBeUndefined();

    const client = new QueryClient();
    client.setQueryData(meQueryOptions.queryKey, null);
    const html = renderToStaticMarkup(
        <QueryClientProvider client={client}>
            <NuqsTestingAdapter>
                <RouterProvider router={router} />
            </NuqsTestingAdapter>
        </QueryClientProvider>
    );
    expect(html).toContain('Cardápio');
});
