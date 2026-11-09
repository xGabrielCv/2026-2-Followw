import { useSyncExternalStore } from 'react';

import { STORAGE_KEYS, storedValue } from '#/lib/local-storage';

/**
 * Credenciais de autoria: cada publicação (post, resposta, material, guia, liberação de índices) nasce
 * com uma chave ALEATÓRIA própria, gerada aqui. O servidor guarda só um verificador dela e nunca recebe um
 * identificador do aluno ou do aparelho reaproveitado entre publicações. Quem guarda as chaves é este
 * navegador (cofre local, sem prazo de expiração, junto das chaves de chamado).
 *
 * O formato antigo guardava um único segredo por conta; ele continua lido só para migrar
 * (`POST /community/migrate`) e depois é descartado.
 */
const SECRET = /^[0-9a-f]{64}$/;

export type AuthorKind = 'post' | 'reply' | 'material' | 'tutorial' | 'share';

interface Credentials {
    /** segredo antigo (um por conta), só até a migração */
    legacy?: string;
    /** `${tipo}:${id}` -> chave aleatória da publicação */
    keys: Record<string, string>;
}

const EMPTY: Credentials = { keys: {} };

export const validAuthor = (value: unknown): value is string =>
    typeof value === 'string' && SECRET.test(value);

const credentials = storedValue<Credentials | string>(STORAGE_KEYS.AUTHOR, EMPTY);

function read(): Credentials {
    const value = credentials.getSnapshot();
    if (typeof value === 'string') return validAuthor(value) ? { legacy: value, keys: {} } : EMPTY;
    return value && typeof value === 'object' && value.keys ? value : EMPTY;
}

const write = (value: Credentials) => credentials.set(value);

/** Chave aleatória nova de 256 bits (64 caracteres hexadecimais). */
export function newKey(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const keyFor = (kind: AuthorKind, id: string): string | undefined =>
    read().keys[`${kind}:${id}`];

export function rememberKey(kind: AuthorKind, id: string, key: string) {
    if (!validAuthor(key)) return;
    const current = read();
    write({ ...current, keys: { ...current.keys, [`${kind}:${id}`]: key } });
}

export function forgetKey(kind: AuthorKind, id: string) {
    const current = read();
    const { [`${kind}:${id}`]: removed, ...rest } = current.keys;
    if (removed !== undefined) write({ ...current, keys: rest });
}

/** Segredo antigo, enquanto a migração não rodou. */
export const legacySecret = (): string | undefined => read().legacy;

/** Guarda o segredo antigo (restauração de backup de versões anteriores). */
export function setAuthorSecret(secret: string) {
    if (validAuthor(secret)) write({ ...read(), legacy: secret });
}

/** Troca o segredo antigo pelas chaves novas devolvidas pela migração. */
export function applyMigration(keys: Record<string, string>) {
    write({ keys: { ...read().keys, ...keys } });
}

/** Chaves de liberação de índices (turma -> chave), para o servidor não contar a turma duas vezes. */
export function shareKeys(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, key] of Object.entries(read().keys))
        if (name.startsWith('share:')) out[name.slice(6)] = key;
    return out;
}

export function rememberShareKeys(keys: Record<string, string>) {
    for (const [classroom, key] of Object.entries(keys)) rememberKey('share', classroom, key);
}

export function forgetShareKeys(classrooms: string[]) {
    for (const classroom of classrooms) forgetKey('share', classroom);
}

/** Reativo: a tela decide "é minha" só pelo que este navegador sabe; o servidor não diz quem publicou. */
export function useIsOwn() {
    const value = useSyncExternalStore(
        credentials.subscribe,
        credentials.getSnapshot,
        credentials.getServerSnapshot
    );
    const keys = typeof value === 'object' && value?.keys ? value.keys : EMPTY.keys;
    return (kind: AuthorKind, id: string, legacyMine = false) =>
        legacyMine || `${kind}:${id}` in keys;
}

// ------------------------------------------------------------------ uso opcional (métricas)

const USAGE = 'usage-keys';
const usageStore = storedValue<Record<string, { id: string; key: string }>>(USAGE, {});

const isoWeek = (date: Date) => {
    const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const weekday = day.getUTCDay() || 7;
    day.setUTCDate(day.getUTCDate() + 4 - weekday);
    const start = Date.UTC(day.getUTCFullYear(), 0, 1);
    return `${day.getUTCFullYear()}-W${String(Math.ceil(((+day - start) / 86400_000 + 1) / 7)).padStart(2, '0')}`;
};

/**
 * Uma chave aleatória por dia, semana e mês, trocada a cada período e sem relação entre si (só vai ao
 * servidor com o consentimento de métricas). Contam alunos únicos sem ligar um dia ao outro.
 */
export function usageHeader(now = new Date()): string {
    const ids = {
        d: now.toISOString().slice(0, 10),
        w: isoWeek(now),
        m: now.toISOString().slice(0, 7)
    };
    const stored = usageStore.getSnapshot();
    const next = { ...stored };
    for (const [period, id] of Object.entries(ids))
        if (stored[period]?.id !== id || !validAuthor(stored[period]?.key))
            next[period] = { id, key: newKey() };
    if (JSON.stringify(next) !== JSON.stringify(stored)) usageStore.set(next);
    return [next.d.key, next.w.key, next.m.key].join(',');
}
