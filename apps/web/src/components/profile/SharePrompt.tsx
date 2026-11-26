import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ShareStatisticsDialog } from '#/components/profile/ShareStatisticsDialog';
import { flushLocalStorage, localStorageRepository } from '#/lib/local-storage';
import { nowInBrasilia } from '#/lib/schedule';
import { evaluateAutoReshare } from '#/lib/statistics-sharing';
import { appConfigQueryOptions } from '#/queries/app-config';
import { allClassroomsQueryOptions } from '#/queries/classrooms';
import { meQueryOptions } from '#/queries/me';
import {
    settingsStore,
    syncStatisticsSharing,
    useUpdateSettings,
    useUserSettings
} from '#/queries/settings';

// Depois da primeira vez, o convite volta em uma a cada tantas aberturas do app.
export const PROMPT_CHANCE = 0.25;
const SEEN_KEY = 'share-prompt-seen';
const SESSION_KEY = 'followw:share-prompt-session';
const SHARED_KEY = 'followw:share-synced-session';

/** Mostra o convite na primeira abertura e depois, ao acaso, uma vez por sessão. */
export function shouldPrompt(seen: boolean, shownInSession: boolean, roll: number) {
    if (shownInSession) return false;
    return !seen || roll < PROMPT_CHANCE;
}

function readSession(key = SESSION_KEY) {
    try {
        return sessionStorage.getItem(key) === '1';
    } catch {
        return true;
    }
}

function markSession(key: string) {
    try {
        sessionStorage.setItem(key, '1');
    } catch {}
}

/** Convite para compartilhar os índices, ao abrir o app, para quem ainda não decidiu. */
export function SharePrompt() {
    const { data: user } = useSuspenseQuery(meQueryOptions);
    const settings = useUserSettings();
    const update = useUpdateSettings();
    const sharing = Boolean(user) && settings.shareStatistics === true;
    const classrooms = useQuery({ ...allClassroomsQueryOptions, enabled: sharing });
    const config = useQuery({ ...appConfigQueryOptions, enabled: sharing });
    // sorteio e histórico lidos uma vez, ao abrir o app
    const [chance] = useState(() => ({
        seen: localStorageRepository.get<boolean>(SEEN_KEY) === true,
        session: readSession(),
        roll: Math.random()
    }));
    const [closed, setClosed] = useState(false);
    const undecided =
        Boolean(user) &&
        settings.shareStatistics !== true &&
        settings.sharePromptDismissed !== true;
    const open = undecided && !closed && shouldPrompt(chance.seen, chance.session, chance.roll);

    useEffect(() => {
        if (!open) return;
        markSession(SESSION_KEY);
        localStorageRepository.set(SEEN_KEY, true);
    }, [open]);

    // Quem ativou o compartilhamento reenvia automaticamente seguindo a política pública configurada no admin.
    const registration = user?.registration;
    const lastKey = settings.lastStatisticsShareKey;
    const lastAt = settings.lastStatisticsShareAt;
    const lastTriggerId = settings.lastStatisticsShareTriggerId;
    useEffect(() => {
        if (
            !sharing ||
            !registration ||
            readSession(SHARED_KEY) ||
            classrooms.data === undefined ||
            config.isPending
        )
            return;
        const decision = evaluateAutoReshare({
            enabled: sharing,
            classrooms: classrooms.data,
            today: nowInBrasilia().date,
            customCalendar: config.data?.calendar,
            policy: config.data?.sharing_policy,
            lastSyncedKey: lastKey,
            lastSyncedAt: lastAt,
            lastTriggerId
        });
        if (!decision.shouldSync || !decision.syncKey) return;
        markSession(SHARED_KEY);
        const targetKey = decision.syncKey;
        const targetTriggerId = decision.triggerId ?? config.data?.sharing_policy?.trigger_id;
        void syncStatisticsSharing(true, decision.includeClosing)
            .then(() => {
                const store = settingsStore(registration);
                store.set({
                    ...store.getSnapshot(),
                    lastStatisticsShareKey: targetKey,
                    lastStatisticsShareAt: new Date().toISOString(),
                    ...(targetTriggerId ? { lastStatisticsShareTriggerId: targetTriggerId } : {})
                });
                return flushLocalStorage();
            })
            .catch(() => {});
    }, [
        sharing,
        registration,
        classrooms.data,
        config.isPending,
        config.data?.calendar,
        config.data?.sharing_policy,
        lastKey,
        lastAt,
        lastTriggerId
    ]);

    if (!undecided) return null;
    const close = () => setClosed(true);
    return (
        <ShareStatisticsDialog
            open={open}
            onOpenChange={(value) => !value && close()}
            pending={update.isPending}
            onShare={() => update.mutate({ body: { shareStatistics: true } }, { onSuccess: close })}
            onNever={() =>
                update.mutate({ body: { sharePromptDismissed: true } }, { onSuccess: close })
            }
        />
    );
}
