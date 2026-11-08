import { useSuspenseQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ShareStatisticsDialog } from '#/components/profile/ShareStatisticsDialog';
import { localStorageRepository } from '#/lib/local-storage';
import { meQueryOptions } from '#/queries/me';
import { syncStatisticsSharing, useUpdateSettings, useUserSettings } from '#/queries/settings';

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

    // Quem compartilha libera também as turmas que o SIGAA trouxer depois, uma vez por sessão.
    const sharing = Boolean(user) && settings.shareStatistics === true;
    useEffect(() => {
        if (!sharing || readSession(SHARED_KEY)) return;
        markSession(SHARED_KEY);
        syncStatisticsSharing(true).catch(() => {});
    }, [sharing]);

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
