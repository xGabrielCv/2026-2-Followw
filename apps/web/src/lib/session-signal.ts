import { localStorageRepository, STORAGE_PREFIX } from '#/lib/local-storage';

const KEY = 'session-version';
const ownChanges = new Set<() => void>();
const version = () => localStorageRepository.get<number>(KEY) ?? 0;

/** Só avisa que a sessão mudou; nenhum identificador ou segredo sai da aba. */
export function announceSessionChange() {
    localStorageRepository.set(KEY, version() + 1);
    for (const acknowledge of ownChanges) acknowledge();
}

export function subscribeSessionChanges(onExternalChange: () => void) {
    if (typeof window === 'undefined') return () => {};
    let seen = version();
    const acknowledge = () => {
        seen = version();
    };
    const check = () => {
        const current = version();
        if (current === seen) return;
        seen = current;
        onExternalChange();
    };
    const storage = (event: StorageEvent) => {
        if (event.key === null || event.key === STORAGE_PREFIX + KEY) check();
    };
    ownChanges.add(acknowledge);
    window.addEventListener('storage', storage);
    window.addEventListener('pageshow', check);
    window.addEventListener('focus', check);
    return () => {
        ownChanges.delete(acknowledge);
        window.removeEventListener('storage', storage);
        window.removeEventListener('pageshow', check);
        window.removeEventListener('focus', check);
    };
}
