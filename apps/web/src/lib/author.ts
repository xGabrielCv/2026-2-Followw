import { localStorageRepository } from '#/lib/local-storage';

// Segredo aleatório do aparelho, sem matrícula; a API deriva a autoria por escopo em memória.
const KEY = 'author';
const SECRET = /^[0-9a-f]{64}$/;

export const validAuthor = (value: unknown): value is string =>
    typeof value === 'string' && SECRET.test(value);

function create(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** O segredo do aparelho; criado na primeira vez. Sem storage (SSR), nenhum. */
export function authorSecret(): string | null {
    if (typeof window === 'undefined') return null;
    const saved = localStorageRepository.get<string>(KEY);
    if (validAuthor(saved)) return saved;
    const secret = create();
    localStorageRepository.set(KEY, secret);
    return localStorageRepository.get<string>(KEY) === secret ? secret : null;
}

export function setAuthorSecret(secret: string) {
    if (validAuthor(secret)) localStorageRepository.set(KEY, secret);
}
