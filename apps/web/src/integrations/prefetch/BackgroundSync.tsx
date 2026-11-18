import { useIsRestoring, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { runBackgroundSync, type SyncStep } from '#/integrations/prefetch/background-sync';
import { migrateLegacyAuthorship } from '#/lib/author-migration';
import { useOnline } from '#/lib/online';
import { electLeader, type LockManagerLike } from '#/lib/tab-leader';
import { appConfigQueryOptions, menuVisible } from '#/queries/app-config';
import { meQueryOptions } from '#/queries/me';

// de novo só quando o app volta depois de um tempo fechado ou em segundo plano
const RERUN_AFTER_MS = 30 * 60_000;
const LEADER_LOCK = 'followw-background-sync';
let lastRun: { registration: string; at: number } | undefined;

const hasWebLocks = () =>
    typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function';

declare global {
    interface Window {
        // diagnóstico: quanto cada passo levou na última sincronização
        followwSync?: SyncStep[];
    }
}

/** Carrega em segundo plano o que o aluno vai abrir, depois de restaurar o cache salvo. */
export function BackgroundSync() {
    const queryClient = useQueryClient();
    const restoring = useIsRestoring();
    const online = useOnline();
    const { data: user } = useQuery(meQueryOptions);
    const { data: config } = useQuery(appConfigQueryOptions);
    const registration = user?.registration;
    const internships = menuVisible(config, 'estagios');
    const shared = hasWebLocks();
    const [leader, setLeader] = useState(!shared);

    useEffect(() => {
        if (!shared) return undefined;
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- LockManager cumpre o formato usado
        const locks = navigator.locks as unknown as LockManagerLike;
        return electLeader({
            name: LEADER_LOCK,
            locks,
            doc: document,
            onChange: setLeader
        });
    }, [shared]);

    // autoria antiga -> chaves independentes por publicação (uma vez; sem efeito se não houver o que migrar)
    useEffect(() => {
        if (!restoring && online && registration && leader) void migrateLegacyAuthorship();
    }, [restoring, online, registration, leader]);

    useEffect(() => {
        if (restoring || !online || !registration || !leader) return undefined;
        const controller = new AbortController();
        const run = () => {
            const recent =
                lastRun?.registration === registration && Date.now() - lastRun.at < RERUN_AFTER_MS;
            if (recent || document.visibilityState !== 'visible') return;
            lastRun = { registration, at: Date.now() };
            void runBackgroundSync(queryClient, controller.signal, { internships }).then((log) => {
                window.followwSync = log;
                return log;
            });
        };
        // deixa a tela aparecer primeiro
        const timer = setTimeout(run, 800);
        document.addEventListener('visibilitychange', run);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('visibilitychange', run);
            controller.abort();
        };
    }, [queryClient, restoring, online, registration, internships, leader]);

    return null;
}
