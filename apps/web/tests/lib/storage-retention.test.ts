import { afterEach, describe, expect, test } from 'bun:test';

import { LocalVault, RETENTION_DAYS, RETENTION_KEY, retentionDays } from '#/lib/local-vault';

const DAY = 86400_000;
const realNow = Date.now;
afterEach(() => {
    Date.now = realNow;
});

function armazenamento(initial: Record<string, string> = {}) {
    const map = new Map(Object.entries(initial));
    return {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => void map.set(key, value),
        removeItem: (key: string) => void map.delete(key),
        key: (index: number) => [...map.keys()][index] ?? null,
        get length() {
            return map.size;
        },
        clear: () => map.clear()
    } as Storage;
}

async function cofre(storage: Storage) {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
        'encrypt',
        'decrypt'
    ]);
    const vault = new LocalVault(storage, async () => key);
    await vault.initialize();
    return vault;
}

describe('prazo de armazenamento', () => {
    test('oferece 7, 30, 90 e 400 dias', () => {
        expect([...RETENTION_DAYS]).toEqual([7, 30, 90, 400]);
    });

    test('aceita 400 e preserva a escolha anterior; valor desconhecido volta ao padrão', () => {
        for (const days of RETENTION_DAYS)
            expect(retentionDays(armazenamento({ [RETENTION_KEY]: String(days) }))).toBe(days);
        expect(retentionDays(armazenamento({ [RETENTION_KEY]: '45' }))).toBe(30);
        expect(retentionDays(armazenamento())).toBe(30);
    });

    test.each([7, 30, 90, 400])('o registro de %i dias expira só depois do prazo', async (days) => {
        const storage = armazenamento({ [RETENTION_KEY]: String(days) });
        const vault = await cofre(storage);
        const start = realNow();
        vault.set('followw:historico', [1]);
        Date.now = () => start + (days - 1) * DAY;
        expect(vault.get('followw:historico')).toEqual([1]);
        Date.now = () => start + (days + 1) * DAY;
        expect(vault.get('followw:historico')).toBeNull();
    });
});

describe('limpar dados acadêmicos', () => {
    test('apaga o cache e mantém as chaves de publicações e chamados', async () => {
        const vault = await cofre(armazenamento());
        vault.set('followw:historico', [1]);
        vault.set('followw:schedule-plans:visitor', [2]);
        vault.set('followw:support', [{ id: 'c1', key: 'segredo' }]);
        vault.set('followw:author:20190001', 'a'.repeat(64));
        vault.set('followw:reviews:20190001', { 123: { token: 't' } });
        vault.clearNonCredentials();
        expect(vault.get('followw:historico')).toBeNull();
        expect(vault.get('followw:schedule-plans:visitor')).toBeNull();
        expect(vault.get('followw:support')).toEqual([{ id: 'c1', key: 'segredo' }]);
        expect(vault.get('followw:author:20190001')).toBe('a'.repeat(64));
        expect(vault.get('followw:reviews:20190001')).toEqual({ 123: { token: 't' } });
    });
});
