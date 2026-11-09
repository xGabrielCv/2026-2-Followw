import { describe, expect, test } from 'bun:test';

import { STORAGE_KEYS } from '#/lib/local-storage';
import { RETENTION_DAYS } from '#/lib/local-vault';
import { LocalVault } from '#/lib/local-vault';
import {
    hasPersonalData,
    OPEN_STATUSES,
    TICKET_CATEGORIES,
    TICKET_CATEGORY_LABELS
} from '#/lib/support';

describe('textos de chamado', () => {
    test('detecta CPF, e-mail e matrícula', () => {
        expect(hasPersonalData('meu cpf 123.456.789-09')).toBe(true);
        expect(hasPersonalData('fale comigo em aluno@exemplo.com')).toBe(true);
        expect(hasPersonalData('matrícula 190012345')).toBe(true);
        expect(hasPersonalData('19/0012345')).toBe(true);
    });

    test('deixa passar texto comum', () => {
        expect(hasPersonalData('A agenda do dia trava no celular desde ontem')).toBe(false);
        expect(hasPersonalData('versão 2.0 e turma 12')).toBe(false);
    });

    test('toda categoria tem rótulo em português', () => {
        for (const category of TICKET_CATEGORIES)
            expect(TICKET_CATEGORY_LABELS[category].length).toBeGreaterThan(3);
    });

    test('chamado resolvido ou encerrado não conta como aberto', () => {
        expect(OPEN_STATUSES).not.toContain('closed');
        expect(OPEN_STATUSES).not.toContain('resolved');
    });
});

describe('chave do chamado no cofre local', () => {
    test('não expira junto com a retenção configurável', async () => {
        const storage = new Map<string, string>();
        const fake = {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => void storage.set(key, value),
            removeItem: (key: string) => void storage.delete(key),
            key: (index: number) => [...storage.keys()][index] ?? null,
            get length() {
                return storage.size;
            },
            clear: () => storage.clear()
        } as Storage;
        const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
            'encrypt',
            'decrypt'
        ]);
        const vault = new LocalVault(fake, async () => key);
        await vault.initialize();
        const old = Date.now() - (Math.max(...RETENTION_DAYS) + 5) * 86400_000;
        const realNow = Date.now;
        vault.set(`followw:${STORAGE_KEYS.SUPPORT}`, [{ id: 'x' }]);
        vault.set('followw:comum', 1);
        Date.now = () => realNow() + (old < 0 ? 0 : 200 * 86400_000);
        try {
            expect(vault.get(`followw:${STORAGE_KEYS.SUPPORT}`)).toEqual([{ id: 'x' }]);
            expect(vault.get('followw:comum')).toBeNull();
        } finally {
            Date.now = realNow;
        }
    });
});
