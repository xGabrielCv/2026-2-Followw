import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    RouterProvider
} from '@tanstack/react-router';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { components } from '#/queries/schema.gen';

import { BottomNavigation } from '#/components/BottomNavigation';
import { AcademicIndexesCard, AcademicPerformance } from '#/components/profile/ProfileOverview';
import { formatAcademicIndex } from '#/lib/profile';
import { appConfigQueryOptions } from '#/queries/app-config';
import { meQueryOptions } from '#/queries/me';
import { Route as MaisRoute } from '#/routes/_app/mais';

test.each(['/perfil/simulador', '/perfil/dados', '/perfil/simulador/'])(
    'mantém Perfil ativo na navegação em %s',
    async (path) => {
        const root = createRootRoute({ component: BottomNavigation });
        const router = createRouter({
            routeTree: root.addChildren([
                createRoute({ getParentRoute: () => root, path: '/perfil/$page' })
            ]),
            history: createMemoryHistory({ initialEntries: [path] }),
            trailingSlash: 'preserve'
        });
        await router.load();
        const markup = renderToStaticMarkup(<RouterProvider router={router} />);
        const active = [...markup.matchAll(/<a\b([^>]*)>/g)]
            .filter(([, attributes]) => attributes.includes('aria-current="page"'))
            .map(([, attributes]) => attributes.match(/aria-label="([^"]*)"/)?.[1]);
        expect(active).toEqual(['Perfil']);
    }
);

test('formata projeções como os índices oficiais sem alterar o cartão compartilhado', () => {
    expect(formatAcademicIndex(4.666666)).toBe('4,667');
    expect(formatAcademicIndex(0)).toBe('0');
    const markup = renderToStaticMarkup(<AcademicIndexesCard user={{ ira: 4.666666, mp: null }} />);
    expect(markup).toContain('4,667');
    expect(markup).not.toContain('MP');
});

test('permite acesso ao simulador mesmo sem índices disponíveis', () => {
    const user = {
        name: 'Discente',
        registration: 'teste',
        photo: null,
        bio: null,
        unit: null,
        course: null,
        entry_semester: null,
        integralization: null,
        workload: null,
        period_max_workload: null,
        ira: null,
        mp: null,
        level: 'Graduação'
    } as const;
    expect(renderToStaticMarkup(<AcademicPerformance user={user} />)).toBe('');
    const markup = renderToStaticMarkup(
        <AcademicPerformance
            user={user}
            action={<a href="/perfil/simulador">Simular IRA e MP</a>}
        />
    );
    expect(markup).toContain('Simular IRA e MP');
    expect(markup).not.toContain('<dl');
});

async function renderMais(user: components['schemas']['UserProfile'] | null) {
    const client = new QueryClient({
        defaultOptions: { queries: { staleTime: Infinity, enabled: false } }
    });
    client.setQueryData(meQueryOptions.queryKey, user);
    client.setQueryData(appConfigQueryOptions.queryKey, {
        menu: {},
        links: { automatricula: null, monitor: null }
    });
    const root = createRootRoute({ component: MaisRoute.options.component });
    const router = createRouter({
        routeTree: root,
        history: createMemoryHistory({ initialEntries: ['/'] })
    });
    await router.load();
    return renderToStaticMarkup(
        <QueryClientProvider client={client}>
            <RouterProvider router={router} />
        </QueryClientProvider>
    );
}

test('exibe atalho de Simular IRA e MP na aba Mais após Estatísticas comparadas', async () => {
    const baseUser: components['schemas']['UserProfile'] = {
        name: 'Discente',
        registration: '202600001',
        photo: null,
        bio: null,
        unit: null,
        course: null,
        entry_semester: null,
        integralization: null,
        workload: null,
        period_max_workload: null,
        ira: 3.43,
        mp: 3.373,
        level: 'Graduação'
    };
    const grad = await renderMais(baseUser);
    expect(grad).toContain('href="/perfil/simulador"');
    expect(grad).toContain('Simular IRA e MP');
    expect(grad.indexOf('Estatísticas comparadas')).toBeLessThan(grad.indexOf('Simular IRA e MP'));
    expect(grad.indexOf('Simular IRA e MP')).toBeLessThan(grad.indexOf('Comunidade'));

    const guest = await renderMais(null);
    expect(guest).toContain('Simular IRA e MP');
    expect(guest).not.toContain('href="/perfil/simulador"');

    const pos = await renderMais({ ...baseUser, level: 'Pós-graduação' });
    expect(pos).not.toContain('Simular IRA e MP');
});
