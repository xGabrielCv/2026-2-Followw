import type { QueryKey } from '@tanstack/react-query';

import { describe, expect, test } from 'bun:test';

import { Route } from '#/routes/_app/buscar';

import { callRoute, fakeQueryClient, runLoader, useBrowserEnvironment } from '../helpers/route';

useBrowserEnvironment();

interface User {
    registration: string;
    unit: { id: number; code: string | null; name: string };
    level?: string;
}

const HISTORY = [
    {
        id: 'A',
        number: '01',
        semester: '2025.2',
        current: false,
        grade: 'SS',
        status: 'concluido',
        professors: [],
        subject: { code: 'FGA0001', name: 'Cálculo' }
    }
];

const loadWith = async (user: User | null, searchStr = '') => {
    const keys: QueryKey[] = [];
    await runLoader(Route, {
        location: { searchStr },
        context: {
            queryClient: fakeQueryClient(
                (queryKey) => {
                    keys.push(queryKey);
                    return queryKey[1] === '/me' ? user : [];
                },
                // as turmas salvas no navegador são o histórico das recomendações
                (queryKey) => (queryKey[1] === '/classrooms' ? HISTORY : undefined)
            )
        }
    });
    return keys;
};

describe('loader da busca de turmas', () => {
    test('sem login carrega só o perfil', async () => {
        expect((await loadWith(null)).map((key) => key[1])).toEqual(['/me']);
    });

    test('com login pré-carrega o histórico e as matérias da unidade', async () => {
        const keys = await loadWith({
            registration: '1',
            unit: { id: 673, code: 'FCTE', name: 'CAMPUS UNB GAMA' }
        });
        expect(keys.map((key) => key[1])).toEqual(['/me', '/classrooms', '/public/subjects']);
        expect(keys[2][2]).toEqual({ params: { query: { unit: 'FCTE' } } });
    });

    test.each([
        null,
        { registration: '1', unit: { id: 673, code: 'FCTE', name: 'CAMPUS UNB GAMA' } }
    ])('uma URL direta pré-carrega a busca única, com perfil %p', async (user) => {
        const keys = await loadWith(user, '?q=calculo');
        const search = keys.filter((key) => String(key[1]).startsWith('/public/'));
        expect(search).toEqual([
            ['get', '/public/search', { params: { query: { q: 'calculo' } } }]
        ]);
    });

    test.each(['ab', 'a'.repeat(33)])('query inválida %s pré-carrega a unidade', async (q) => {
        const keys = await loadWith(
            { registration: '1', unit: { id: 673, code: 'FCTE', name: 'CAMPUS UNB GAMA' } },
            `?q=${q}`
        );
        const subjects = keys.filter((key) => key[1] === '/public/subjects');
        expect(subjects.map((key) => key[2])).toEqual([{ params: { query: { unit: 'FCTE' } } }]);
        expect((await loadWith(null, `?q=${q}`)).map((key) => key[1])).toEqual(['/me']);
    });

    test('mudanças na URL deixam a busca para o debounce do componente', () => {
        expect(callRoute(Route.options.shouldReload, { cause: 'stay' })).toBe(false);
        expect(callRoute(Route.options.shouldReload, { cause: 'enter' })).toBe(true);
    });
});

describe('recomendações somente na busca', () => {
    const student = {
        registration: '1',
        unit: { id: 673, code: 'FCTE', name: 'CAMPUS UNB GAMA' },
        level: 'Graduação'
    };
    test('graduação sem texto e filtros carrega recomendações em vez da lista da unidade', async () => {
        const keys = await loadWith(student);
        expect(keys.map((key) => key[1])).toEqual(['/me', '/classrooms', '/public/subjects']);
        // o histórico vai junto: o servidor não guarda as menções
        expect(keys[2][2]).toEqual({
            params: { query: { history: ['FGA0001:2025.2:SS:concluido'] } }
        });
    });
    test('pesquisa usa a busca única em vez das recomendações', async () => {
        const keys = await loadWith(student, '?q=calculo');
        expect(keys.map((key) => key[1])).toEqual(['/me', '/classrooms', '/public/search']);
    });
    test('visitante não carrega recomendações', async () => {
        expect((await loadWith(null)).map((key) => key[1])).toEqual(['/me']);
    });
});

describe('loader das categorias da busca', () => {
    test.each([
        ['classrooms', ['/me', '/classrooms', '/public/search'], ['subjects']],
        ['all', ['/me', '/classrooms', '/public/search'], undefined],
        ['courses', ['/me', '/public/search'], ['courses']],
        ['professors', ['/me', '/public/search'], ['professors']]
    ] as const)(
        'categoria %s pré-carrega somente seus resultados',
        async (category, expected, type) => {
            const keys = await loadWith(
                {
                    registration: '1',
                    unit: { id: 673, code: 'FCTE', name: 'CAMPUS UNB GAMA' },
                    level: 'Graduação'
                },
                `?q=Carlos Silva&category=${category}`
            );
            expect(keys.map((key) => key[1])).toEqual([...expected]);
            expect(keys.at(-1)?.[2]).toStrictEqual({
                params: { query: { q: 'Carlos Silva', type } }
            });
        }
    );
    test.each([
        ['courses', '/public/courses'],
        ['professors', '/public/professors']
    ])(
        'categoria %s sem texto pré-carrega só a primeira página do catálogo',
        async (category, path) => {
            const keys = await loadWith(
                {
                    registration: '1',
                    unit: { id: 673, code: 'FCTE', name: 'CAMPUS UNB GAMA' },
                    level: 'Graduação'
                },
                `?category=${category}`
            );
            expect(keys.map((key) => key[1])).toEqual(['/me', path]);
            expect(keys.at(-1)?.[2]).toStrictEqual({
                params: { query: { q: undefined, page: 1 } }
            });
        }
    );
});
