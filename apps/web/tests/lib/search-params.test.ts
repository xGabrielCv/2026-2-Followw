import { describe, expect, test } from 'bun:test';
import { createSerializer } from 'nuqs/server';

import {
    loadSearchParams,
    parseRouterSearch,
    searchParsers,
    stringifyRouterSearch,
    validateSearch
} from '#/lib/search-params';

describe('parâmetros da busca', () => {
    test.each(['001', '1234567890123456789012345', '"Carlos"', '[1,2]', 'null'])(
        'o Router preserva a consulta textual %s sem conversão JSON',
        (q) => {
            const search = { q, category: 'courses', extra: { page: 2 } };
            expect(parseRouterSearch(stringifyRouterSearch(search))).toEqual(search);
            expect(parseRouterSearch(`?q=${encodeURIComponent(q)}`).q).toBe(q);
        }
    );

    test('o semestre fica como texto na URL, sem virar número nem ganhar aspas', () => {
        const search = { q: 'FGA0302', semester: '2027.1' };
        expect(stringifyRouterSearch(search)).toBe('?q=FGA0302&semester=2027.1');
        expect(parseRouterSearch('?semester=2027.1')).toEqual({ semester: '2027.1' });
    });

    test('restaura a query e os filtros tipados da URL', () => {
        expect(loadSearchParams('?q=calculo&category=courses&semester=2027.1')).toEqual({
            q: 'calculo',
            category: 'courses',
            semester: '2027.1'
        });
    });

    test('filtros ausentes ou inválidos usam os padrões', () => {
        expect(loadSearchParams('?category=Eletiva&semester=proximo')).toEqual({
            q: '',
            category: 'all',
            semester: null
        });
    });

    test('limpar consulta e filtros remove os parâmetros', () => {
        const serialize = createSerializer(searchParsers);
        expect(serialize({ q: '', category: 'all' })).toBe('');
        expect(serialize({ q: 'calculo', category: null })).toBe('?q=calculo');
    });

    test('o Router e o nuqs compartilham os mesmos parsers', () => {
        expect(
            validateSearch['~standard'].validate({ q: 'Carlos Silva', category: 'courses' })
        ).toEqual({
            value: { q: 'Carlos Silva', category: 'courses' }
        });
    });
});
