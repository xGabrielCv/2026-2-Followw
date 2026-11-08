import { QueryClient } from '@tanstack/react-query';
import { describe, expect, test } from 'bun:test';

import { invalidateChanged } from '#/integrations/prefetch/ContentSync';

const key = (path: string) => ['get', path, {}];

describe('checagem de atualizações da nuvem', () => {
    test('só a parte que mudou é relida', () => {
        const client = new QueryClient();
        for (const path of ['/public/professors/ratings', '/forum', '/groups/{code}'])
            client.setQueryData(key(path), { ok: true });
        const before = { reviews: 'a', forum: 'b', groups: 'c' };
        const changed = invalidateChanged(client, before, { ...before, reviews: 'z' });
        expect(changed).toEqual(['reviews']);
        expect(client.getQueryState(key('/public/professors/ratings'))?.isInvalidated).toBe(true);
        expect(client.getQueryState(key('/forum'))?.isInvalidated).toBe(false);
        expect(client.getQueryState(key('/groups/{code}'))?.isInvalidated).toBe(false);
    });

    test('sem mudança, nada é relido', () => {
        const client = new QueryClient();
        client.setQueryData(key('/forum'), {});
        expect(invalidateChanged(client, { forum: 'b' }, { forum: 'b' })).toEqual([]);
        expect(client.getQueryState(key('/forum'))?.isInvalidated).toBe(false);
    });
});
