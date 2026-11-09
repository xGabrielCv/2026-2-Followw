import { get, update } from 'idb-keyval';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const VAULT_KEY = 'followw:encrypted-vault';
const KEY_ID = 'followw-device-key-v1';
export const RETENTION_KEY = 'followw:retention-days';
export const RETENTION_DAYS = [7, 30, 90, 400] as const;
export const DEFAULT_RETENTION_DAYS = 30;
const DAY = 86400_000;
const PUBLIC_KEYS = new Set([
    'followw:theme',
    'followw:layout',
    'followw:install-dismissed',
    'followw:analytics-consent',
    RETENTION_KEY
]);

export const publicStorageKey = (key: string) => PUBLIC_KEYS.has(key);
const credentialKey = (key: string) => /^followw:(author|reviews|support)(:|$)/.test(key);

export function retentionDays(storage?: Storage): number {
    try {
        const days = Number(storage?.getItem(RETENTION_KEY));
        return RETENTION_DAYS.some((value) => value === days) ? days : DEFAULT_RETENTION_DAYS;
    } catch {
        return DEFAULT_RETENTION_DAYS;
    }
}

const encode = (bytes: Uint8Array) => {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
};
const decode = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

export async function deviceKey(): Promise<CryptoKey> {
    const existing = await get<CryptoKey>(KEY_ID);
    if (existing) return existing;
    const created = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
        'encrypt',
        'decrypt'
    ]);
    await update<CryptoKey>(KEY_ID, (current) => current ?? created);
    return (await get<CryptoKey>(KEY_ID))!;
}

export async function sealLocal(value: unknown, context: string, key?: CryptoKey): Promise<string> {
    key ??= await deviceKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const bytes = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: encoder.encode(`followw:v1:${context}`) },
        key,
        encoder.encode(JSON.stringify(value))
    );
    return `v1.${encode(iv)}.${encode(new Uint8Array(bytes))}`;
}

export async function openLocal(value: string, context: string, key?: CryptoKey): Promise<unknown> {
    key ??= await deviceKey();
    const [version, iv, body, extra] = value.split('.');
    if (version !== 'v1' || !iv || !body || extra || decode(iv).length !== 12)
        throw new Error('Formato local inválido');
    const bytes = await crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: decode(iv),
            additionalData: encoder.encode(`followw:v1:${context}`)
        },
        key,
        decode(body)
    );
    return JSON.parse(decoder.decode(bytes));
}

interface Entry {
    value: unknown;
    savedAt: number;
}
type Values = Record<string, Entry>;
type Change = { key: string; entry?: Entry } | { clear: true };

function validValues(value: unknown): value is Values {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        Object.entries(value).every(
            ([key, item]) =>
                key.startsWith('followw:') &&
                typeof item === 'object' &&
                item !== null &&
                'savedAt' in item &&
                typeof item.savedAt === 'number' &&
                Number.isFinite(item.savedAt) &&
                'value' in item
        )
    );
}

/** Chave não exportável no IndexedDB; protege cópias em disco, não scripts da mesma origem. */
export class LocalVault {
    private values: Values = {};
    private initialized = false;
    private initializing?: Promise<void>;
    private changes: Change[] = [];
    private queue = Promise.resolve();
    private key?: CryptoKey;
    error = false;
    get ready() {
        return this.initialized;
    }

    constructor(
        private readonly storage: Storage,
        private readonly loadKey = deviceKey
    ) {}

    initialize(): Promise<void> {
        return (this.initializing ??= this.restore());
    }

    private async read(): Promise<Values> {
        const saved = this.storage.getItem(VAULT_KEY);
        if (!saved) return {};
        const value = await openLocal(saved, 'preferences', this.key);
        if (!validValues(value)) throw new Error('Armazenamento local corrompido');
        return value;
    }

    private async restore() {
        try {
            this.key = await this.loadKey();
            const values = await this.read();
            const legacy: string[] = [];
            for (let index = 0; index < this.storage.length; index++) {
                const key = this.storage.key(index);
                if (
                    !key ||
                    !key.startsWith('followw:') ||
                    publicStorageKey(key) ||
                    key === VAULT_KEY
                )
                    continue;
                try {
                    const value: unknown = JSON.parse(this.storage.getItem(key)!);
                    if (!values[key]) values[key] = { value, savedAt: Date.now() };
                    legacy.push(key);
                } catch {
                    /* Preserva registros antigos ilegíveis para recuperação manual. */
                }
            }
            this.values = { ...values, ...this.values };
            this.initialized = true;
            // Só remove texto antigo depois de confirmar a gravação cifrada.
            await this.write(values);
            for (const key of legacy) this.storage.removeItem(key);
            await this.flush();
        } catch {
            this.error = true;
            throw new Error(
                'Não foi possível abrir o armazenamento protegido. Os dados existentes foram preservados.'
            );
        }
    }

    get(key: string): unknown {
        const entry = this.values[key];
        if (
            entry &&
            (credentialKey(key) || Date.now() - entry.savedAt < retentionDays(this.storage) * DAY)
        )
            return entry.value;
        if (entry) this.remove(key);
        // Leitura transitória para migração; nunca escreve novos dados em texto aberto.
        if (!this.initialized) {
            try {
                return JSON.parse(this.storage.getItem(key) ?? 'null');
            } catch {
                return null;
            }
        }
        return null;
    }

    set(key: string, value: unknown) {
        const entry = { value: JSON.parse(JSON.stringify(value)), savedAt: Date.now() };
        this.values[key] = entry;
        this.changes.push({ key, entry });
        this.schedule();
    }

    remove(key: string) {
        delete this.values[key];
        this.storage.removeItem(key);
        this.changes.push({ key });
        this.schedule();
    }

    clear() {
        this.values = {};
        this.changes.push({ clear: true });
        this.schedule();
    }

    /** Apaga o que é acadêmico e mantém as credenciais (autoria, avaliações, chamados). */
    clearNonCredentials() {
        for (const key of Object.keys(this.values)) if (!credentialKey(key)) this.remove(key);
    }

    private schedule() {
        if (!this.initialized) return;
        this.queue = this.queue
            .then(() => this.write())
            .catch(() => {
                this.error = true;
            });
    }

    private async write(migration?: Values) {
        const persist = async () => {
            const count = this.changes.length;
            let values = { ...(await this.read()), ...migration };
            for (const change of this.changes.slice(0, count)) {
                if ('clear' in change) values = {};
                else if (change.entry) values[change.key] = change.entry;
                else delete values[change.key];
            }
            const oldest = Date.now() - retentionDays(this.storage) * DAY;
            for (const [key, entry] of Object.entries(values))
                if (!credentialKey(key) && entry.savedAt <= oldest) delete values[key];
            const sealed = await sealLocal(values, 'preferences', this.key);
            this.storage.setItem(VAULT_KEY, sealed);
            this.changes.splice(0, count);
        };
        if (typeof navigator !== 'undefined' && navigator.locks)
            await navigator.locks.request(VAULT_KEY, persist);
        else await persist();
    }

    async flush() {
        if (this.initialized && this.changes.length) this.schedule();
        await this.queue;
        if (this.error) throw new Error('Falha ao salvar dados protegidos');
    }
}

const vaults = new WeakMap<Storage, LocalVault>();
export function localVault(storage: Storage) {
    let vault = vaults.get(storage);
    if (!vault) {
        vault = new LocalVault(storage);
        vaults.set(storage, vault);
    }
    return vault;
}

export async function initializeLocalVault() {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') return;
    await localVault(window.localStorage).initialize();
}

/** Limpeza do cache acadêmico sem perder as chaves das publicações e dos chamados do aluno. */
export async function clearAcademicData(storage: Storage) {
    const vault = localVault(storage);
    vault.clearNonCredentials();
    await vault.flush();
}
