import { newKey } from '#/lib/author';
import { storedValue } from '#/lib/local-storage';
import { localVault } from '#/lib/local-vault';

const credentials = storedValue<Record<string, { day: number; key: string }>>('material-quota', {});

export async function materialUploadKey(code: string) {
    const day = Math.floor(Date.now() / 86400_000);
    const current = credentials.getSnapshot();
    const saved = current[code];
    if (saved?.day === day) return saved.key;
    const key = newKey();
    const next: typeof current = {};
    for (const [name, value] of Object.entries(current)) if (value.day === day) next[name] = value;
    next[code] = { day, key };
    credentials.set(next);
    if (typeof window !== 'undefined') await localVault(window.localStorage).flush();
    return key;
}
