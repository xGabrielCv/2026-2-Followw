import { localVault, publicStorageKey, VAULT_KEY } from '#/lib/local-vault';

export const STORAGE_PREFIX = 'followw:';

export const STORAGE_KEYS = {
    THEME: 'theme',
    SCHEDULE: 'schedule',
    SCHEDULE_PLANS: 'schedule-plans',
    ACADEMIC_SIMULATION: 'academic-simulation',
    LAYOUT: 'layout',
    REVIEWS: 'reviews',
    // chamados de suporte: a chave de cada um é a única prova de posse
    SUPPORT: 'support',
    // credenciais aleatórias de cada publicação (e o segredo antigo, até migrar)
    AUTHOR: 'author',
    ALERT_DISMISSED: 'semester-alert-dismissed',
    STUDENT_CARD: 'student-card',
    STATS_SOURCE: 'stats-source'
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

const SCOPED_KEYS = new Set<string>([
    STORAGE_KEYS.SCHEDULE_PLANS,
    STORAGE_KEYS.REVIEWS,
    STORAGE_KEYS.ACADEMIC_SIMULATION,
    STORAGE_KEYS.ALERT_DISMISSED,
    STORAGE_KEYS.STUDENT_CARD,
    'author'
]);
let activeAccount: string | undefined;
export const localAccount = () => activeAccount ?? 'visitor';
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
const ACCOUNT_KEYS: string[] = [
    STORAGE_KEYS.SCHEDULE_PLANS,
    STORAGE_KEYS.REVIEWS,
    STORAGE_KEYS.ACADEMIC_SIMULATION,
    STORAGE_KEYS.STUDENT_CARD
];
const stores = new Map<string, { clear: () => void; reset: () => void }>();

/** Valor salvo no storage e observável pelo `useSyncExternalStore`. */
export function storedValue<T>(
    key: string,
    empty: T,
    options?: { register?: boolean; onServerWrite?: () => void; onServerClear?: () => void }
) {
    const listeners = new Set<() => void>();
    const headlessScoped = new Map<string, T>();
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
            if (typeof window === 'undefined') options?.onServerWrite?.();
            localStorageRepository.set(key, value);
            update(value);
        },
        atAccount(account: string): { getSnapshot: () => T; set: (value: T) => void } {
            if (!SCOPED_KEYS.has(key)) throw new Error('Este valor não é separado por conta');
            return {
                getSnapshot: (): T => {
                    if (account === localAccount()) return store.getSnapshot();
                    if (!getStorage()) return headlessScoped.get(account) ?? empty;
                    return localStorageRepository.get<T>(`${key}:${account}`) ?? empty;
                },
                set: (value: T): void => {
                    if (account === localAccount()) store.set(value);
                    else if (!getStorage()) headlessScoped.set(account, value);
                    else localStorageRepository.set(`${key}:${account}`, value);
                }
            };
        },
        clear: () => {
            headlessScoped.clear();
            localStorageRepository.remove(key);
            update(empty);
            if (typeof window === 'undefined') options?.onServerClear?.();
        },
        reset: () => {
            snapshot = undefined;
            for (const listener of listeners) listener();
        }
    };
    if (options?.register !== false) stores.set(key, store);
    return store;
}

export function registeredStoreCount() {
    return { stores: stores.size, accounts: accountStores.size };
}

export function resetLocalStores() {
    for (const store of stores.values()) store.reset();
}

export async function clearRegistrationData(registration: string) {
    const storage = getStorage();
    if (!storage) return;
    for (const prefix of [
        'settings',
        'events',
        'marks',
        'post-reading',
        STORAGE_KEYS.SCHEDULE_PLANS,
        STORAGE_KEYS.ACADEMIC_SIMULATION,
        STORAGE_KEYS.ALERT_DISMISSED
    ]) {
        localStorageRepository.remove(`${prefix}:${registration}`);
    }
    const vault = localVault(storage);
    vault.clearRegistrationNonCredentials(registration);
    resetLocalStores();
    await vault.flush();
}

export function clearAccountStorage() {
    if (!activeAccount || activeAccount === 'visitor') {
        for (const key of ACCOUNT_KEYS) stores.get(key)?.clear();
    }
    selectLocalAccount();
}

export async function flushLocalStorage() {
    const storage = getStorage();
    if (storage) await localVault(storage).flush();
}

export function observeLocalStorage() {
    const storage = getStorage();
    if (!storage) return () => {};
    const refresh = (event: StorageEvent) => {
        if (event.key !== VAULT_KEY && event.key !== null) return;
        void localVault(storage)
            .refresh()
            .then(() => {
                for (const store of stores.values()) store.reset();
                return undefined;
            });
    };
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
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
    const existing = accountStores.get(key);
    if (existing) {
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- mesma chave, mesmo tipo
        return existing as ReturnType<typeof storedValue<T>>;
    }
    if (typeof window === 'undefined') {
        const ephemeral: ReturnType<typeof storedValue<unknown>> = storedValue<unknown>(
            key,
            empty,
            {
                register: false,
                onServerWrite: () => {
                    stores.set(key, ephemeral);
                    accountStores.set(key, ephemeral);
                },
                onServerClear: () => {
                    stores.delete(key);
                    accountStores.delete(key);
                }
            }
        );
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- no SSR não retém matrícula em leitura
        return ephemeral as ReturnType<typeof storedValue<T>>;
    }
    const store = storedValue<unknown>(key, empty);
    accountStores.set(key, store);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- mesma chave, mesmo tipo
    return store as ReturnType<typeof storedValue<T>>;
}
