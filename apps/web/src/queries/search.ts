import type { components } from '#/queries/schema.gen';

import { api } from '#/queries/api';

export type SearchResult = components['schemas']['SearchResult'];
export type SearchType = components['schemas']['SearchType'];

// sem semestre a chave fica igual à de antes, e o cache salvo continua valendo
export const searchQueryOptions = (q: string, type?: SearchType[], semester?: string) =>
    api.queryOptions('get', '/public/search', {
        params: { query: semester ? { q, type, semester } : { q, type } }
    });
