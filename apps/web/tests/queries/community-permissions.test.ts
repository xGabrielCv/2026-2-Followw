import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { communityRequest } from '#/queries/community-permissions';

// Request do Bun não implementa credentials; exercitamos o contrato do navegador.
const browser = new Window({ url: 'https://app.test/' });
const originalRequest = Object.getOwnPropertyDescriptor(globalThis, 'Request')!;
beforeAll(() => {
    Object.defineProperty(globalThis, 'Request', {
        value: browser.Request,
        configurable: true,
        writable: true
    });
});
afterAll(async () => {
    Object.defineProperty(globalThis, 'Request', originalRequest);
    await browser.happyDOM.abort();
});

test('comprova sessão separadamente e publica sem cookies, autorização global ou métricas', async () => {
    const issuance: Request[] = [];
    const request = new Request('https://app.test/api/forum', {
        method: 'POST',
        credentials: 'include',
        headers: {
            Cookie: 'refresh_token=sintetico',
            Authorization: 'Bearer global',
            'X-Followw-Author': 'a'.repeat(64),
            'X-Followw-Usage': 'nao-enviar'
        },
        body: '{"body":"texto comunitário"}'
    });
    const publish = await communityRequest(request, async (grant) => {
        issuance.push(grant);
        return Response.json({ token: 'somente-esta-operacao' });
    });
    expect(issuance).toHaveLength(1);
    const grant = issuance[0];
    expect(grant.credentials).toBe('include');
    expect(grant.headers.has('X-Followw-Author')).toBe(false);
    expect(await grant.json()).toEqual({ method: 'POST', path: '/forum' });
    expect(publish.credentials).toBe('omit');
    expect(publish.referrerPolicy).toBe('no-referrer');
    expect(publish.headers.get('X-Followw-Permit')).toBe('somente-esta-operacao');
    expect(publish.headers.get('X-Followw-Author')).toBe('a'.repeat(64));
    expect(
        ['cookie', 'authorization', 'X-Followw-Usage', 'X-Followw-Metrics'].every(
            (name) => !publish.headers.has(name)
        )
    ).toBe(true);
    expect(await publish.json()).toEqual({ body: 'texto comunitário' });
});

test.each([
    'forum',
    'materials',
    'groups',
    'reviews',
    'tutorials',
    'support',
    'reports',
    'community'
])('leitura de %s é pública, sem cookies e sem emissão de comprovante', async (root) => {
    const publish = await communityRequest(
        new Request(`https://app.test/api/${root}`, { headers: { Cookie: 'privado' } }),
        async () => {
            throw new Error('leitura não deve comprovar sessão');
        }
    );
    expect(publish.credentials).toBe('omit');
    expect(publish.headers.has('cookie')).toBe(false);
});

test('falha ao comprovar não produz requisição comunitária nem cache de comprovante', async () => {
    const request = new Request('https://app.test/api/reviews', { method: 'POST', body: '{}' });
    const error = await communityRequest(request, async () =>
        Response.json({ detail: 'Entre novamente' }, { status: 401 })
    ).then(
        () => null,
        (failed: unknown) => failed
    );
    expect(error).toMatchObject({ status: 401 });
    expect(request.headers.has('X-Followw-Permit')).toBe(false);
});
