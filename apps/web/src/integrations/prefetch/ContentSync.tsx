import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { api } from '#/queries/api';

// O que cada parte da nuvem alimenta no app, pelo caminho da API na chave da query.
export const CONTENT_PARTS: Record<string, string[]> = {
    reviews: ['/reviews', '/public/professors'],
    groups: ['/groups'],
    materials: ['/materials'],
    forum: ['/forum'],
    tutorials: ['/tutorials'],
    statistics: ['/public/subjects', '/public/professors'],
    config: ['/public/config']
};

// barato (uma consulta curta no banco): o app confere com frequência
export const contentVersionQueryOptions = api.queryOptions(
    'get',
    '/public/config/version',
    {},
    { staleTime: 0, refetchInterval: 2 * 60_000, refetchOnWindowFocus: true }
);

/** Marca como vencido (e relê o que está na tela) só o que mudou entre duas versões. */
export function invalidateChanged(
    queryClient: QueryClient,
    before: Record<string, string>,
    after: Record<string, string>
): string[] {
    const changed = Object.keys(after).filter((part) => before[part] !== after[part]);
    const prefixes = changed.flatMap((part) => CONTENT_PARTS[part] ?? []);
    if (prefixes.length)
        void queryClient.invalidateQueries({
            predicate: ({ queryKey: [, path] }) =>
                typeof path === 'string' &&
                path !== '/public/config/version' &&
                prefixes.some((prefix) => path.startsWith(prefix))
        });
    return changed;
}

/** Confere em segundo plano se a comunidade mudou (nova avaliação, post, material...). */
export function ContentSync() {
    const queryClient = useQueryClient();
    const { data } = useQuery(contentVersionQueryOptions);
    const last = useRef<Record<string, string> | null>(null);

    useEffect(() => {
        if (!data) return;
        if (last.current) invalidateChanged(queryClient, last.current, data.parts);
        last.current = data.parts;
    }, [data, queryClient]);

    return null;
}
