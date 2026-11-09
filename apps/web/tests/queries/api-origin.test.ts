import { afterEach, expect, spyOn, test } from 'bun:test';

import { loadSharedMenu } from '#/queries/restaurant-share';

const original = process.env.API_INTERNAL_URL;
afterEach(() => {
    if (original === undefined) delete process.env.API_INTERNAL_URL;
    else process.env.API_INTERNAL_URL = original;
});

test('prévia pública não escolhe o destino da API pelo Host recebido nem encaminha cookies', async () => {
    process.env.API_INTERNAL_URL = 'http://127.0.0.1:8011';
    const network = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json([]));
    try {
        await loadSharedMenu(
            new Request('http://127.0.0.1:9/ru/imagem', {
                headers: { Cookie: 'academico=sintetico' }
            }),
            { campus: 'Darcy', date: '2026-11-09', meal: 'lunch' }
        );
        const input = network.mock.calls[0]?.[0];
        expect(input instanceof URL ? input.origin : '').toBe('http://127.0.0.1:8011');
        expect(new Headers(network.mock.calls[0]?.[1]?.headers).has('cookie')).toBe(false);
    } finally {
        network.mockRestore();
    }
});
