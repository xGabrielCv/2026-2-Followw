import { defaultParseSearch, defaultStringifySearch } from '@tanstack/react-router';
import { useQueryStates } from 'nuqs';
import {
    createLoader,
    createParser,
    createStandardSchemaV1,
    parseAsString,
    parseAsStringLiteral
} from 'nuqs/server';

import { SEARCH_CATEGORIES } from '#/lib/search-categories';

export const searchParsers = {
    q: parseAsString.withDefault(''),
    category: parseAsStringLiteral(SEARCH_CATEGORIES).withDefault('all'),
    // semestre da oferta; sem ele, o atual
    semester: createParser({
        parse: (value) => (/^\d{4}\.\d$/.test(value) ? value : null),
        serialize: String
    })
};

export const validateSearch = createStandardSchemaV1(searchParsers, { partialOutput: true });
export const loadSearchParams = createLoader(searchParsers);

// A consulta e o semestre (`2027.1`) são texto mesmo quando parecem número ou JSON.
const TEXT_PARAMS = ['q', 'semester', 'subject'];

export function parseRouterSearch(searchStr: string) {
    const search: Record<string, unknown> = { ...defaultParseSearch(searchStr) };
    const params = new URLSearchParams(searchStr);
    for (const key of TEXT_PARAMS) {
        const value = params.get(key);
        if (value !== null) search[key] = value;
    }
    return search;
}

export function stringifyRouterSearch(search: Record<string, unknown>) {
    const params = new URLSearchParams(defaultStringifySearch(search));
    for (const key of TEXT_PARAMS) {
        const value = search[key];
        if (typeof value === 'string') params.set(key, value);
    }
    return params.size ? `?${params}` : '';
}

export const useSearchState = () =>
    useQueryStates(searchParsers, { history: 'replace', scroll: false });
