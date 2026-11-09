import { localVault, publicStorageKey } from '#/lib/local-vault';

export const STORAGE_PREFIX = 'followw:';

export const STORAGE_KEYS = {
    THEME: 'theme',
    SCHEDULE: 'schedule',
    SCHEDULE_PLANS: 'schedule-plans',
    LAYOUT: 'layout',
    REVIEWS: 'reviews',
    // chamados de suporte: a chave de cada um é a única prova de posse
    SUPPORT: 'support',
    // credenciais aleatórias de cada publicação (e o segredo antigo, até migrar)
    AUTHOR: 'author'
} as const;

function getStorage(): Storage | null {
    if (typeof window === 'undefined') {
        return null;
    }
    try {
        return window.localStorage ?? null;
    } catch {
        return null;
    }
}

/** Cookies bloqueados: o navegador também nega o storage do site e o login não se mantém. */
export function isStorageBlocked(): boolean {
    if (typeof window === 'undefined') return false;
    if (!window.navigator.cookieEnabled) return true;
    try {
        void window.localStorage;
        return false;
    } catch {
        return true;
    }
}

const SCOPED_KEYS = new Set<string>([STORAGE_KEYS.SCHEDULE_PLANS, STORAGE_KEYS.REVIEWS, 'author']);
let activeAccount: string | undefined;
function formatKey(key: string): string {
    const scope = activeAccount ?? 'visitor';
    return `${STORAGE_PREFIX}${SCOPED_KEYS.has(key) ? `${key}:${scope}` : key}`;
}

export interface LocalStorageRepository {
    get<T = unknown>(key: string, fallback?: T): T | null;
    set(key: string, value: unknown): void;
    remove(key: string): void;
    clear(): void;
}

export const localStorageRepository: LocalStorageRepository = {
    get<T = unknown>(key: string, fallback?: T): T | null {
        const storage = getStorage();
        if (!storage) {
            return fallback ?? null;
        }

        try {
            if (!publicStorageKey(formatKey(key))) {
                // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- tipo definido pelo repositório chamador
                return (localVault(storage).get(formatKey(key)) as T | null) ?? fallback ?? null;
            }
            const item = storage.getItem(formatKey(key));
            if (item === null) {
                return fallback ?? null;
            }
            const parsed: T = JSON.parse(item);
            return parsed;
        } catch {
            return fallback ?? null;
        }
    },

    set(key: string, value: unknown): void {
        const storage = getStorage();
        if (!storage) {
            return;
        }

        try {
            if (!publicStorageKey(formatKey(key))) {
                localVault(storage).set(formatKey(key), value);
                return;
            }
            const serialized = JSON.stringify(value);
            storage.setItem(formatKey(key), serialized);
        } catch {
            // Ignora falhas de serialização ou escrita no storage
        }
    },

    remove(key: string): void {
        const storage = getStorage();
        if (!storage) {
            return;
        }

        try {
            if (!publicStorageKey(formatKey(key))) localVault(storage).remove(formatKey(key));
            storage.removeItem(formatKey(key));
        } catch {
            // Ignora falhas de remoção no storage
        }
    },

    clear(): void {
        const storage = getStorage();
        if (!storage) {
            return;
        }

        try {
            localVault(storage).clear();
            const keysToRemove: string[] = [];
            for (let i = 0; i < storage.length; i++) {
                const storageKey = storage.key(i);
                if (storageKey?.startsWith(STORAGE_PREFIX)) {
                    keysToRemove.push(storageKey);
                }
            }

            for (const key of keysToRemove) {
                storage.removeItem(key);
            }
        } catch {
            // Ignora falhas na limpeza do storage
        }
    }
};

// Dados da conta, apagados ao trocar de sessão.
const ACCOUNT_KEYS: string[] = [STORAGE_KEYS.SCHEDULE_PLANS, STORAGE_KEYS.REVIEWS];
const stores = new Map<string, { clear: () => void; reset: () => void }>();

/** Valor salvo no storage e observável pelo `useSyncExternalStore`. */
export function storedValue<T>(key: string, empty: T) {
    const listeners = new Set<() => void>();
    let snapshot: T | undefined;
    const update = (value: T) => {
        snapshot = value;
        for (const listener of listeners) listener();
    };
    const store = {
        getSnapshot: () => {
            const storage = getStorage();
            if (storage && localVault(storage).ready)
                snapshot = localStorageRepository.get<T>(key) ?? empty;
            return (snapshot ??= localStorageRepository.get<T>(key) ?? empty);
        },
        getServerSnapshot: () => empty,
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
                if (listeners.size === 0) snapshot = undefined;
            };
        },
        set: (value: T) => {
            localStorageRepository.set(key, value);
            update(value);
        },
        clear: () => {
            localStorageRepository.remove(key);
            update(empty);
        },
        reset: () => {
            snapshot = undefined;
            for (const listener of listeners) listener();
        }
    };
    stores.set(key, store);
    return store;
}

export function clearAccountStorage() {
    if (!activeAccount || activeAccount === 'visitor') {
        for (const key of ACCOUNT_KEYS) stores.get(key)?.clear();
    }
    selectLocalAccount();
}

/** Troca a conta sem apagar cenários ou segredos de autoria da conta anterior. */
export function selectLocalAccount(registration?: string) {
    if (typeof window === 'undefined') return;
    const next = registration ?? 'visitor';
    if (next === activeAccount) return;
    const storage = getStorage();
    if (storage && registration) {
        const vault = localVault(storage);
        for (const key of SCOPED_KEYS) {
            const legacy = `${STORAGE_PREFIX}${key}`;
            const target = `${legacy}:${registration}`;
            const value = vault.get(legacy);
            if (value != null && vault.get(target) == null) {
                vault.set(target, value);
                vault.remove(legacy);
            }
        }
    }
    activeAccount = next;
    for (const store of stores.values()) store.reset();
}

const accountStores = new Map<string, ReturnType<typeof storedValue<unknown>>>();

/**
 * Valor da conta guardado só neste navegador, numa chave por matrícula: sobrevive ao logout e
 * a meses sem abrir o app, e nunca vai para o servidor.
 */
export function accountStore<T>(key: string, empty: T) {
    let store = accountStores.get(key);
    if (!store) {
        store = storedValue<unknown>(key, empty);
        accountStores.set(key, store);
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- mesma chave, mesmo tipo
    return store as ReturnType<typeof storedValue<T>>;
}
