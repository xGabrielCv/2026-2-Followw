import {
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    RouterProvider
} from '@tanstack/react-router';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { BottomNavigation } from '#/components/BottomNavigation';
import { AcademicIndexesCard, AcademicPerformance } from '#/components/profile/ProfileOverview';
import { formatAcademicIndex } from '#/lib/profile';

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
