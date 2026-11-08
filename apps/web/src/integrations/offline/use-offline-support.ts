import { noop, onlineManager, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { persistQueryCache, warmPages } from '#/integrations/offline/storage';
import { useOnline } from '#/lib/online';
import { nowInBrasilia } from '#/lib/schedule';
import { meQueryOptions } from '#/queries/me';
import { campusOf, prefetchWeekMenus } from '#/queries/restaurant';

// espera a página assentar antes de ir à rede só para o modo offline
const WARMUP_DELAY = 2_000;

// o SW só é gerado no build de produção
const serviceWorkerEnabled = () => import.meta.env.PROD && 'serviceWorker' in navigator;

/** Liga o modo offline: cache persistido, service worker e pré-carga. Devolve se o cache ainda está sendo restaurado. */
export function useOfflineSupport() {
    const queryClient = useQueryClient();
    const online = useOnline();
    const { data: user, isSuccess } = useQuery(meQueryOptions);
    const [restoring, setRestoring] = useState(true);
    const loggedIn = Boolean(user);
    const campus = campusOf(user?.unit?.code);

    // só depois de a rota (com o código dela) carregar e hidratar: o SSR não traz dado pessoal, e
    // o cache restaurado antes disso faria a tela divergir do HTML do servidor
    const routerIdle = useRouterState({ select: (state) => state.status === 'idle' });
    const started = useRef(false);
    const stop = useRef<() => void>(noop);
    // para de salvar só ao desmontar: trocar de rota não interrompe a persistência
    useEffect(() => () => stop.current(), []);
    useEffect(() => {
        if (!routerIdle || started.current) return;
        started.current = true;
        onlineManager.setOnline(navigator.onLine);
        if (serviceWorkerEnabled()) navigator.serviceWorker.register('/sw.js').catch(noop);
        requestAnimationFrame(() => {
            stop.current = persistQueryCache(queryClient, () => setRestoring(false));
        });
    }, [queryClient, routerIdle]);

    // com o app aberto e online, deixa páginas e cardápio da semana prontos para o modo offline
    useEffect(() => {
        if (!online || !isSuccess) return undefined;
        const timeout = setTimeout(() => {
            if (serviceWorkerEnabled()) void warmPages(loggedIn);
            prefetchWeekMenus(queryClient, campus, nowInBrasilia().date).catch(noop);
        }, WARMUP_DELAY);
        return () => clearTimeout(timeout);
    }, [queryClient, online, isSuccess, loggedIn, campus]);

    return restoring;
}
