import type { PersistedClient } from '@tanstack/react-query-persist-client';

import { isRecommendationsKey } from '#/queries/recommendations';

type SavedQuery = PersistedClient['clientState']['queries'][number];

export function profileOwner(value: unknown): string | null {
    return value &&
        typeof value === 'object' &&
        'registration' in value &&
        typeof value.registration === 'string'
        ? value.registration
        : null;
}

export function cacheOwner(client: PersistedClient) {
    return profileOwner(
        client.clientState.queries.find(
            (query) => query.queryKey[0] === 'get' && query.queryKey[1] === '/me'
        )?.state.data
    );
}

export function publicCacheQuery(query: SavedQuery) {
    const path = query.queryKey[1];
    if (typeof path !== 'string' || query.queryKey[0] !== 'get') return false;
    if (path === '/public/search' || path.startsWith('/public/subjects')) return false;
    return (
        path.startsWith('/public/') ||
        /^\/(groups|reviews|materials|forum|tutorials)(\/|$)/.test(path)
    );
}

function withoutOwnership(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(withoutOwnership);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
            key,
            key === 'mine' ? false : withoutOwnership(child)
        ])
    );
}

/** O perfil confirmado governa a restauração; offline permite só a última conta guardada. */
export function accountSnapshot(
    client: PersistedClient,
    currentOwner: string | null | undefined,
    online: boolean
): PersistedClient {
    const savedOwner = cacheOwner(client);
    const privateAllowed =
        savedOwner !== null && (savedOwner === currentOwner || (!online && !currentOwner));
    return {
        ...client,
        clientState: {
            ...client.clientState,
            mutations: [],
            queries: client.clientState.queries.flatMap((query) => {
                if (
                    isRecommendationsKey(query.queryKey) ||
                    (typeof query.queryKey[1] === 'string' &&
                        query.queryKey[1].startsWith('/support'))
                )
                    return [];
                if (privateAllowed) return online && query.queryKey[1] === '/me' ? [] : [query];
                return publicCacheQuery(query)
                    ? [
                          {
                              ...query,
                              state: { ...query.state, data: withoutOwnership(query.state.data) }
                          }
                      ]
                    : [];
            })
        }
    };
}
