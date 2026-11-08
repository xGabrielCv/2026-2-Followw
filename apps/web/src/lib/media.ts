import { useSyncExternalStore } from 'react';

import { readLayoutMode, subscribeLayoutMode } from '#/lib/layout';

// mesmo limite da variante `desk:` (styles.css)
const DESKTOP_QUERY = '(min-width: 64rem)';

const subscribe = (callback: () => void) => {
    const query = window.matchMedia(DESKTOP_QUERY);
    query.addEventListener('change', callback);
    const unsubscribe = subscribeLayoutMode(callback);
    return () => {
        query.removeEventListener('change', callback);
        unsubscribe();
    };
};

const isDesktop = () => {
    const mode = readLayoutMode();
    return mode === 'auto' ? window.matchMedia(DESKTOP_QUERY).matches : mode === 'desktop';
};

/** Layout de computador (pela tela ou forçado no perfil); no SSR vale o celular, o padrão. */
export function useDesktop() {
    return useSyncExternalStore(subscribe, isDesktop, () => false);
}
