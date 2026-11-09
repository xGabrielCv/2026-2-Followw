import type { PersistedClient } from '@tanstack/react-query-persist-client';

import { dehydrate, QueryClient } from '@tanstack/react-query';
import { expect, test } from 'bun:test';

import { accountSnapshot, cacheOwner } from '#/integrations/offline/account-cache';

function saved(owner: string | null = 'conta-a'): PersistedClient {
    const client = new QueryClient();
    client.setQueryData(
        ['get', '/me'],
        owner ? { registration: owner, name: 'Perfil privado' } : null
    );
    client.setQueryData(['get', '/classrooms'], [{ subject: 'Privada', grade: 'SS' }]);
    client.setQueryData(['get', '/public/config'], { menu: { materiais: true } });
    client.setQueryData(['get', '/forum'], {
        items: [{ id: 'post', mine: true, body: 'Público' }]
    });
    client.setQueryData(['get', '/public/search'], { recommendation: 'Personalizada' });
    const result = { buster: 'dev:0', timestamp: Date.now(), clientState: dehydrate(client) };
    client.clear();
    return result;
}
const paths = (client: PersistedClient) =>
    client.clientState.queries.map((query) => query.queryKey[1]);

test.each([null, undefined, 'conta-b'])(
    'online não restaura dados de outra conta ou sessão ausente: %s',
    (current) => {
        const snapshot = saved();
        const restored = accountSnapshot(snapshot, current, true);
        expect(paths(restored)).toEqual(['/public/config', '/forum']);
        expect(JSON.stringify(restored)).not.toContain('Perfil privado');
        expect(JSON.stringify(restored)).not.toContain('Personalizada');
        expect(restored.clientState.queries[1].state.data).toMatchObject({
            items: [{ mine: false }]
        });
        expect(
            snapshot.clientState.queries.find((query) => query.queryKey[1] === '/forum')?.state.data
        ).toMatchObject({ items: [{ mine: true }] });
    }
);

test('mesma conta restaura turmas sem substituir perfil recém-confirmado', () => {
    expect(paths(accountSnapshot(saved(), 'conta-a', true))).toContain('/classrooms');
    expect(paths(accountSnapshot(saved(), 'conta-a', true))).not.toContain('/me');
});

test('offline restaura última conta local sem confundir conta já selecionada', () => {
    const restored = accountSnapshot(saved(), null, false);
    expect(cacheOwner(restored)).toBe('conta-a');
    expect(paths(restored)).toContain('/classrooms');
    expect(paths(accountSnapshot(saved(), 'conta-b', false))).not.toContain('/classrooms');
});

test('cache sem perfil não recebe autorização implícita para dados privados', () => {
    const restored = accountSnapshot(saved(null), null, false);
    expect(cacheOwner(restored)).toBeNull();
    expect(paths(restored)).not.toContain('/classrooms');
});
