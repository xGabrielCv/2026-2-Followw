import { describe, expect, test } from 'bun:test';

import type { LockManagerLike, VisibilityLike } from '#/lib/tab-leader';

import { electLeader } from '#/lib/tab-leader';

/** Web Locks em memória: um dono por nome, os demais esperam na fila e podem ser cancelados. */
function fakeLocks(): LockManagerLike {
    const queue: { run: () => Promise<void> }[] = [];
    let busy = false;
    const next = () => {
        const item = queue.shift();
        if (item) void item.run();
        else busy = false;
    };
    return {
        request: (_name, { signal }, callback) =>
            new Promise((resolve, reject) => {
                const run = async () => {
                    busy = true;
                    await callback();
                    resolve(undefined);
                    next();
                };
                const item = { run };
                signal?.addEventListener('abort', () => {
                    const index = queue.indexOf(item);
                    if (index >= 0) queue.splice(index, 1);
                    reject(new DOMException('abortado', 'AbortError'));
                });
                if (busy) queue.push(item);
                else void run();
            })
    };
}

function fakeTab(locks: LockManagerLike, visible = true) {
    const listeners = new Set<() => void>();
    const doc: VisibilityLike & { visibilityState: string } = {
        visibilityState: visible ? 'visible' : 'hidden',
        addEventListener: (_type, listener) => listeners.add(listener),
        removeEventListener: (_type, listener) => listeners.delete(listener)
    };
    const state = { leader: false, changes: [] as boolean[] };
    const stop = electLeader({
        name: 'x',
        locks,
        doc,
        onChange: (leader) => {
            state.leader = leader;
            state.changes.push(leader);
        }
    });
    const show = (value: boolean) => {
        doc.visibilityState = value ? 'visible' : 'hidden';
        for (const listener of listeners) listener();
    };
    return { state, stop, show };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('líder entre abas', () => {
    test('com duas abas visíveis só uma consulta', async () => {
        const locks = fakeLocks();
        const a = fakeTab(locks);
        const b = fakeTab(locks);
        await settle();
        expect([a.state.leader, b.state.leader].filter(Boolean)).toHaveLength(1);
    });

    test('aba em segundo plano nunca assume a liderança', async () => {
        const locks = fakeLocks();
        const escondida = fakeTab(locks, false);
        await settle();
        expect(escondida.state.leader).toBe(false);
        const visivel = fakeTab(locks);
        await settle();
        expect(visivel.state.leader).toBe(true);
        expect(escondida.state.leader).toBe(false);
    });

    test('ao esconder a aba líder, outra aba visível assume', async () => {
        const locks = fakeLocks();
        const a = fakeTab(locks);
        const b = fakeTab(locks);
        await settle();
        expect(a.state.leader).toBe(true);
        a.show(false);
        await settle();
        expect(a.state.leader).toBe(false);
        expect(b.state.leader).toBe(true);
    });

    test('ao voltar para a aba ela entra na fila e a líder atual continua', async () => {
        const locks = fakeLocks();
        const a = fakeTab(locks);
        const b = fakeTab(locks);
        await settle();
        a.show(false);
        await settle();
        a.show(true);
        await settle();
        expect(b.state.leader).toBe(true);
        expect(a.state.leader).toBe(false);
    });

    test('fechar a aba líder passa a vez e não deixa duas líderes', async () => {
        const locks = fakeLocks();
        const a = fakeTab(locks);
        const b = fakeTab(locks);
        await settle();
        a.stop();
        await settle();
        expect(a.state.leader).toBe(false);
        expect(b.state.leader).toBe(true);
        b.stop();
        await settle();
        expect(b.state.leader).toBe(false);
    });
});
