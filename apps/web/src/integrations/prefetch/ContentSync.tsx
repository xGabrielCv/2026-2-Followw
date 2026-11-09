import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { electLeader, type LockManagerLike } from '#/lib/tab-leader';
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

const LEADER_LOCK = 'followw-content-sync';
const CHANNEL = 'followw-content-version';

/** Sem Web Locks ou BroadcastChannel cada aba confere por conta própria, como antes. */
const sharedAcrossTabs = () =>
    typeof navigator !== 'undefined' &&
    'locks' in navigator &&
    typeof BroadcastChannel !== 'undefined';

/**
 * Confere em segundo plano se a comunidade mudou (nova avaliação, post, material...). Com várias abas,
 * só a aba visível consulta (a cada 2 minutos) e avisa as outras, em vez de cada uma repetir o pedido.
 */
export function ContentSync() {
    const queryClient = useQueryClient();
    const shared = sharedAcrossTabs();
    const [leader, setLeader] = useState(!shared);
    const { data } = useQuery({ ...contentVersionQueryOptions, enabled: leader });
    const last = useRef<Record<string, string> | null>(null);
    const channel = useRef<BroadcastChannel | null>(null);

    useEffect(() => {
        if (!shared) return undefined;
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- LockManager cumpre o formato usado
        const locks = navigator.locks as unknown as LockManagerLike;
        const stopElection = electLeader({
            name: LEADER_LOCK,
            locks,
            doc: document,
            onChange: setLeader
        });
        const listener = new BroadcastChannel(CHANNEL);
        channel.current = listener;
        listener.addEventListener('message', (event: MessageEvent<Record<string, string>>) => {
            if (last.current) invalidateChanged(queryClient, last.current, event.data);
            last.current = event.data;
        });
        return () => {
            stopElection();
            listener.close();
            channel.current = null;
        };
    }, [shared, queryClient]);

    useEffect(() => {
        if (!data) return;
        if (last.current) invalidateChanged(queryClient, last.current, data.parts);
        const changed = JSON.stringify(last.current) !== JSON.stringify(data.parts);
        last.current = data.parts;
        if (changed) channel.current?.postMessage(data.parts);
    }, [data, queryClient]);

    return null;
}
