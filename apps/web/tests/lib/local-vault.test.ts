import { expect, test } from 'bun:test';

import { LocalVault, openLocal, sealLocal } from '#/lib/local-vault';

import { MemoryStorage } from '../helpers/memory-storage';

const key = () =>
    crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

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
