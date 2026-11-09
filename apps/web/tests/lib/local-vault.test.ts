import { expect, spyOn, test } from 'bun:test';

import { LocalVault, openLocal, sealLocal } from '#/lib/local-vault';

import { MemoryStorage } from '../helpers/memory-storage';

const key = () =>
    crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

test('gravação pode se recuperar de falha transitória sem perder alterações pendentes', async () => {
    const storage = new MemoryStorage();
    const vault = new LocalVault(storage, key);
    await vault.initialize();
    const write = spyOn(storage, 'setItem').mockImplementation(() => {
        throw new Error('Disco cheio');
    });
    vault.set('followw:settings:sintetico', { displayName: 'Mantido em memória' });
    const error = await vault.flush().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect(error instanceof Error && error.message).toContain('Falha ao salvar');
    write.mockRestore();
    await vault.flush();
    expect(vault.error).toBe(false);
    expect(vault.get('followw:settings:sintetico')).toEqual({ displayName: 'Mantido em memória' });
});

test('duas instâncias preservam e enxergam as alterações distintas ao gravar', async () => {
    const storage = new MemoryStorage();
    const device = await key();
    const a = new LocalVault(storage, async () => device);
    const b = new LocalVault(storage, async () => device);
    await a.initialize();
    await b.initialize();
    a.set('followw:settings:a', { note: 'A' });
    await a.flush();
    b.set('followw:settings:b', { note: 'B' });
    await b.flush();
    expect(b.get('followw:settings:a')).toEqual({ note: 'A' });
    expect(b.get('followw:settings:b')).toEqual({ note: 'B' });
});

test('migra texto antigo sem perder dados e grava somente conteúdo cifrado', async () => {
    const storage = new MemoryStorage();
    storage.setItem('followw:settings:251000001', JSON.stringify({ displayName: 'Sintético' }));
    const device = await key();
    const vault = new LocalVault(storage, async () => device);
    await vault.initialize();
    expect(storage.getItem('followw:settings:251000001')).toBeNull();
    const sealed = storage.getItem('followw:encrypted-vault')!;
    expect(sealed).not.toContain('251000001');
    expect(sealed).not.toContain('Sintético');
    const restored = new LocalVault(storage, async () => device);
    await restored.initialize();
    expect(restored.get('followw:settings:251000001')).toEqual({ displayName: 'Sintético' });
});

test('nonce muda, contexto isola conteúdo e chave não pode ser exportada', async () => {
    const device = await key();
    const first = await sealLocal({ grade: 'SS' }, 'cache', device);
    const second = await sealLocal({ grade: 'SS' }, 'cache', device);
    expect(first).not.toBe(second);
    expect(await openLocal(first, 'cache', device)).toEqual({ grade: 'SS' });
    expect(
        await openLocal(first, 'preferences', device).then(
            () => false,
            () => true
        )
    ).toBe(true);
    expect(
        await openLocal(first, 'cache', await key()).then(
            () => false,
            () => true
        )
    ).toBe(true);
    expect(
        await crypto.subtle.exportKey('raw', device).then(
            () => false,
            () => true
        )
    ).toBe(true);
});

test('não apaga dados antigos se migração ou chave falhar', async () => {
    const storage = new MemoryStorage();
    storage.setItem('followw:events:251000001', '[1]');
    const vault = new LocalVault(storage, async () => {
        throw new Error('bloqueado');
    });
    expect(
        await vault.initialize().then(
            () => false,
            () => true
        )
    ).toBe(true);
    expect(storage.getItem('followw:events:251000001')).toBe('[1]');
});

test('respeita retenção por registro e isola configurações de contas', async () => {
    const storage = new MemoryStorage();
    const device = await key();
    const ancient = Date.now() - 91 * 86400_000;
    storage.setItem(
        'followw:encrypted-vault',
        await sealLocal(
            {
                'followw:settings:251000001': { savedAt: ancient, value: { name: 'Antigo' } }
            },
            'preferences',
            device
        )
    );
    const vault = new LocalVault(storage, async () => device);
    await vault.initialize();
    expect(vault.get('followw:settings:251000001')).toBeNull();
    vault.set('followw:settings:252000002', { name: 'Outra conta' });
    await vault.flush();
    expect(vault.get('followw:settings:251000001')).toBeNull();
    expect(vault.get('followw:settings:252000002')).toEqual({ name: 'Outra conta' });
});

test('corrupção não substitui arquivo existente por vazio', async () => {
    const storage = new MemoryStorage();
    storage.setItem('followw:encrypted-vault', 'v1.invalido.adulterado');
    const vault = new LocalVault(storage, key);
    expect(
        await vault.initialize().then(
            () => false,
            () => true
        )
    ).toBe(true);
    expect(storage.getItem('followw:encrypted-vault')).toBe('v1.invalido.adulterado');
});

test('registro legado ilegível é preservado cifrado para recuperação e limpeza acadêmica', async () => {
    const storage = new MemoryStorage();
    const source = 'followw:settings:251000001';
    storage.setItem(source, '{"nota":"SS",incompleto');
    const device = await key();
    const vault = new LocalVault(storage, async () => device);
    await vault.initialize();
    expect(storage.getItem(source)).toBeNull();
    const sealed = storage.getItem('followw:encrypted-vault')!;
    expect(sealed).not.toContain('nota');
    expect(sealed).not.toContain('251000001');
    const restored = new LocalVault(storage, async () => device);
    await restored.initialize();
    expect(restored.get(`followw:recovery:${source}`)).toEqual({
        sourceKey: source,
        raw: '{"nota":"SS",incompleto'
    });
    restored.clearNonCredentials();
    await restored.flush();
    expect(restored.get(`followw:recovery:${source}`)).toBeNull();
});

test('cifras adulteradas são recusadas e IVs não se repetem no lote', async () => {
    const device = await key();
    const records = await Promise.all(
        Array.from({ length: 256 }, () => sealLocal({ grade: 'SS' }, 'grades', device))
    );
    expect(new Set(records.map((record) => record.split('.')[1])).size).toBe(256);
    const parts = records[0].split('.');
    const bytes = Uint8Array.from(atob(parts[2]), (char) => char.charCodeAt(0));
    bytes[0] = bytes[0] ^ 1;
    parts[2] = btoa(String.fromCharCode(...bytes));
    expect(
        await openLocal(parts.join('.'), 'grades', device).then(
            () => false,
            () => true
        )
    ).toBe(true);
});
