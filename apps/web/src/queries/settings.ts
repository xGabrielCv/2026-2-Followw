import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useMemo, useSyncExternalStore } from 'react';

import { accountStore } from '#/lib/local-storage';
import { apiClient } from '#/queries/client';
import { meQueryOptions } from '#/queries/me';

/**
 * Configurações do aluno: ficam só neste navegador (por matrícula), por tempo indeterminado.
 * O servidor só fica sabendo do compartilhamento dos índices, e sem guardar quem compartilhou.
 */
export interface UserSettings {
    displayName?: string | null;
    // matérias marcadas como concluídas à mão no fluxo
    completedSubjects?: string[];
    // índice da paleta escolhido para cada matéria na agenda
    subjectColors?: Record<string, number>;
    shareStatistics?: boolean;
    // "não compartilhar e não perguntar de novo"
    sharePromptDismissed?: boolean;
}

export type UserSettingsPatch = Partial<UserSettings>;

const EMPTY_SETTINGS: UserSettings = {};
const noopSubscribe = () => () => {};
const emptySnapshot = () => EMPTY_SETTINGS;

export const settingsStore = (registration: string) =>
    accountStore<UserSettings>(`settings:${registration}`, EMPTY_SETTINGS);

/** As configurações da conta logada; sem login, vazias. */
export function useUserSettings(): UserSettings {
    const { data: user } = useSuspenseQuery(meQueryOptions);
    const store = user ? settingsStore(user.registration) : null;
    return useSyncExternalStore(
        store?.subscribe ?? noopSubscribe,
        store?.getSnapshot ?? emptySnapshot,
        emptySnapshot
    );
}

/** Libera ou recolhe as estatísticas das turmas do aluno nos índices públicos. */
export async function syncStatisticsSharing(shared: boolean) {
    const { error } = await apiClient.PUT('/me/statistics-sharing', { body: { shared } });
    if (error) throw new Error('Não foi possível mudar o compartilhamento');
}

export function useUpdateSettings() {
    const queryClient = useQueryClient();
    const { data: user } = useSuspenseQuery(meQueryOptions);
    return useMutation({
        mutationFn: async ({ body }: { body: UserSettingsPatch }) => {
            if (!user) throw new Error('Entre na conta para salvar');
            // só o compartilhamento passa pela API; o resto nunca sai do navegador
            if (body.shareStatistics !== undefined)
                await syncStatisticsSharing(body.shareStatistics);
            const store = settingsStore(user.registration);
            const next = { ...store.getSnapshot(), ...body };
            store.set(next);
            return next;
        },
        onSuccess: (_, { body }) => {
            // matérias concluídas mudam as recomendações; o compartilhamento, os índices
            if (body.completedSubjects)
                void queryClient.invalidateQueries({ queryKey: ['get', '/public/subjects'] });
            if (body.shareStatistics !== undefined)
                void queryClient.invalidateQueries({
                    queryKey: ['get', '/public/subjects/{code}/outcomes']
                });
        }
    });
}

/** Matérias marcadas como concluídas à mão no fluxo. */
export function useCompletedSubjects() {
    const { completedSubjects } = useUserSettings();
    const update = useUpdateSettings();
    const codes = useMemo(() => new Set(completedSubjects ?? []), [completedSubjects]);
    const toggle = async (code: string) => {
        const next = new Set(codes);
        if (!next.delete(code)) next.add(code);
        await update.mutateAsync({ body: { completedSubjects: [...next].toSorted() } });
    };
    return { codes, toggle, pending: update.isPending, failed: update.isError };
}

/** Cor que o aluno escolheu para cada matéria na agenda (índice da paleta); sem ela, a automática. */
export function useSubjectColors() {
    const { subjectColors } = useUserSettings();
    const update = useUpdateSettings();
    const chosen = useMemo(() => subjectColors ?? {}, [subjectColors]);
    const setColor = (code: string, index: number | null) => {
        const next = { ...chosen };
        if (index == null) delete next[code];
        else next[code] = index;
        update.mutate({ body: { subjectColors: next } });
    };
    return { chosen, setColor, pending: update.isPending, failed: update.isError };
}
