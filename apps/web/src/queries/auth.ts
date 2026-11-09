import { type Query, type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
    clearOfflineData,
    restoreAccountCache,
    withPausedOfflineWrites
} from '#/integrations/offline/storage';
import { clearAccountStorage, selectLocalAccount } from '#/lib/local-storage';
import { useOnline } from '#/lib/online';
import { announceSessionChange, subscribeSessionChanges } from '#/lib/session-signal';
import { api } from '#/queries/api.ts';
import { apiClient } from '#/queries/client.ts';
import { ApiError } from '#/queries/errors.ts';
import { meQueryOptions } from '#/queries/me.ts';
import { sendTechnicalEvent } from '#/queries/telemetry';

// todo o cache é apagado no logout; só o /me fica a cargo de quem chama
const isAccountQuery = ({ queryKey: [, path] }: Query) => path !== '/me';
const refreshing = new Set<AbortController>();

function cancelRefresh() {
    for (const controller of refreshing) controller.abort();
    refreshing.clear();
}

async function clearUserData(queryClient: QueryClient, removeCache = true) {
    cancelRefresh();
    const cancelled = queryClient.cancelQueries();
    clearAccountStorage();
    queryClient.removeQueries({ predicate: isAccountQuery });
    await cancelled;
    if (removeCache) await clearOfflineData();
}

export function clearSession(queryClient: QueryClient) {
    cancelRefresh();
    if (queryClient.getQueryData(meQueryOptions.queryKey)) announceSessionChange();
    const cleared = clearUserData(queryClient);
    queryClient.setQueryData(meQueryOptions.queryKey, null);
    return cleared;
}

/** O login deu certo, mas o /me seguinte não levou os cookies que ele gravou. */
export class SessionNotStoredError extends Error {
    constructor() {
        super('O navegador não guardou os cookies do login');
        this.name = 'SessionNotStoredError';
    }
}

/** Troca os dados da conta anterior pelo perfil da nova; falha se ele não vier. */
export async function startSession(queryClient: QueryClient) {
    cancelRefresh();
    announceSessionChange();
    const cancelled = clearUserData(queryClient, false);
    queryClient.setQueryData(meQueryOptions.queryKey, null);
    return withPausedOfflineWrites(queryClient, async () => {
        await cancelled;
        // um /me em voo saiu sem os cookies do login, e o `query` o reaproveitaria
        await queryClient.cancelQueries({ queryKey: meQueryOptions.queryKey });
        const user = await queryClient.query({ ...meQueryOptions, staleTime: 0 });
        if (!user) throw new SessionNotStoredError();
        selectLocalAccount(user.registration);
        await restoreAccountCache(queryClient);
        return user;
    });
}

export function useLogin() {
    const queryClient = useQueryClient();
    // retorna a promise para o login seguir pendente até o perfil chegar
    return api.useMutation('post', '/auth/sigaa', {
        onMutate: () => cancelRefresh(),
        onSuccess: async () => {
            try {
                await startSession(queryClient);
            } catch (error) {
                if (error instanceof SessionNotStoredError)
                    void sendTechnicalEvent('login_session_lost');
                throw error;
            }
        }
    });
}

export function useLogout(onLoggedOut?: () => void) {
    const queryClient = useQueryClient();
    return api.useMutation('delete', '/auth/sigaa', {
        onMutate: () => cancelRefresh(),
        onSuccess: async () => {
            await clearSession(queryClient);
            onLoggedOut?.();
        }
    });
}

// por matrícula: outra conta na mesma aba também renova
let refreshedRegistration: string | undefined;

export function useSessionRefresh() {
    const queryClient = useQueryClient();
    const { data: user } = useQuery(meQueryOptions);
    const online = useOnline();

    useEffect(
        () =>
            subscribeSessionChanges(() => {
                const cancelled = clearUserData(queryClient, false);
                queryClient.setQueryData(meQueryOptions.queryKey, null);
                void withPausedOfflineWrites(queryClient, async () => {
                    await cancelled;
                    const fresh = await queryClient.query({ ...meQueryOptions, staleTime: 0 });
                    selectLocalAccount(fresh?.registration);
                    await restoreAccountCache(queryClient);
                }).catch(() => {});
            }),
        [queryClient]
    );

    useEffect(() => {
        selectLocalAccount(user?.registration);
        if (!user || !online || refreshedRegistration === user.registration) return;
        refreshedRegistration = user.registration;
        const controller = new AbortController();
        refreshing.add(controller);
        apiClient
            .POST('/auth/sigaa/refresh', { signal: controller.signal })
            .catch((error: unknown) => {
                if (controller.signal.aborted) return;
                if (error instanceof ApiError && error.isUnauthorized)
                    void clearSession(queryClient).catch(() => {});
            })
            .finally(() => refreshing.delete(controller));
    }, [user, online, queryClient]);
}
