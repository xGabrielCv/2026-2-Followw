import {
    MutationCache,
    QueryCache,
    QueryClient,
    environmentManager,
    onlineManager
} from '@tanstack/react-query';

import { PERSIST_MAX_AGE } from '#/integrations/offline/storage.ts';
import { initializeQueryTimers } from '#/lib/query-timers';
import { clearSession } from '#/queries/auth.ts';
import { ApiError } from '#/queries/errors.ts';

initializeQueryTimers();

function discardExpiredSession(queryClient: QueryClient, preserveProfileRequest = false) {
    void clearSession(queryClient, preserveProfileRequest).catch(() => {});
}

export function getContext() {
    const isServer = environmentManager.isServer();
    // sessão expirou enquanto o /me ainda estava em cache
    const onError = (error: Error) => {
        if (!isServer && error instanceof ApiError && error.isUnauthorized)
            discardExpiredSession(queryClient);
    };
    const queryClient: QueryClient = new QueryClient({
        queryCache: new QueryCache({ onError }),
        mutationCache: new MutationCache({
            onError: (error, _variables, _context, mutation) => {
                const [method, path] = mutation.options.mutationKey ?? [];
                if (method === 'post' && path === '/auth/sigaa') return;
                onError(error);
            }
        }),
        defaultOptions: {
            queries: {
                staleTime: 60_000,
                gcTime: isServer ? undefined : PERSIST_MAX_AGE,
                networkMode: 'always',
                retry: (failureCount, error) =>
                    !isServer &&
                    onlineManager.isOnline() &&
                    !(error instanceof ApiError && error.status < 500) &&
                    failureCount < 2
            },
            mutations: { networkMode: 'always' }
        }
    });

    // A transição é observada por cliente, inclusive quando /me converte um 401 em null.
    if (!isServer) {
        let hadProfile = false;
        queryClient.getQueryCache().subscribe((event) => {
            if (
                event.type !== 'updated' ||
                event.query.queryKey[0] !== 'get' ||
                event.query.queryKey[1] !== '/me'
            )
                return;
            const profile = event.query.state.data;
            const expired =
                hadProfile &&
                profile === null &&
                event.action.type === 'success' &&
                !event.action.manual;
            hadProfile = Boolean(profile);
            if (expired) discardExpiredSession(queryClient, true);
        });
    }

    return {
        queryClient
    };
}
export default function TanstackQueryProvider() {}
