import { STORAGE_KEYS, STORAGE_PREFIX, localStorageRepository } from '#/lib/local-storage';

/** Automático segue a largura da tela; os outros forçam o layout em qualquer aparelho. */
export type LayoutMode = 'auto' | 'mobile' | 'desktop';

const MODES: LayoutMode[] = ['auto', 'mobile', 'desktop'];

export const LAYOUT_LABELS: Record<LayoutMode, string> = {
    auto: 'Automático',
    mobile: 'Celular',
    desktop: 'Computador'
};

export function isLayoutMode(value: unknown): value is LayoutMode {
    return MODES.some((mode) => mode === value);
}

export function readLayoutMode(): LayoutMode {
    const stored = localStorageRepository.get(STORAGE_KEYS.LAYOUT);
    return isLayoutMode(stored) ? stored : 'auto';
}

const listeners = new Set<() => void>();

export function subscribeLayoutMode(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function applyLayoutMode(mode: LayoutMode): void {
    if (mode === 'auto') delete document.documentElement.dataset.layout;
    else document.documentElement.dataset.layout = mode;
}

export function saveLayoutMode(mode: LayoutMode): void {
    if (mode === 'auto') localStorageRepository.remove(STORAGE_KEYS.LAYOUT);
    else localStorageRepository.set(STORAGE_KEYS.LAYOUT, mode);
    applyLayoutMode(mode);
    for (const listener of listeners) listener();
}

// Roda no <head> antes da hidratação, como o do tema, para o layout não piscar.
export const layoutScript = `(() => {
    let mode;
    try { mode = JSON.parse(localStorage.getItem('${STORAGE_PREFIX}${STORAGE_KEYS.LAYOUT}')); } catch {}
    if (mode === 'mobile' || mode === 'desktop') document.documentElement.dataset.layout = mode;
})();`;
