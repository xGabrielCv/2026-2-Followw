import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';

import { sendTechnicalEvent, setAnalyticsConsent } from '#/queries/telemetry';

import { useDom } from '../helpers/dom';

useDom();
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
beforeEach(() => {
    setAnalyticsConsent(false);
    network = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
});
afterEach(() => {
    setAnalyticsConsent(false);
    network.mockRestore();
});

test('desligado por padrão não faz requisição nem cria identificador', async () => {
    await sendTechnicalEvent('login_session_lost');
    expect(network).not.toHaveBeenCalled();
    expect(document.cookie).toBe('');
});

test('envia somente evento permitido à própria API sem cookies ou referrer', async () => {
    document.cookie = 'sintetico=privado';
    setAnalyticsConsent(true);
    await sendTechnicalEvent('login_session_lost');
    expect(network).toHaveBeenCalledTimes(1);
    expect(network.mock.calls[0]).toMatchObject([
        '/api/public/config/metrics',
        {
            method: 'POST',
            body: '{"event":"login_session_lost"}',
            credentials: 'omit',
            cache: 'no-store',
            referrerPolicy: 'no-referrer',
            mode: 'same-origin'
        }
    ]);
    document.cookie = 'sintetico=; Max-Age=0';
});

test('desativar cancela envio pendente e não envia nem repete depois', async () => {
    let captured: AbortSignal | null | undefined;
    network.mockImplementation(
        Object.assign(
            async (
                _url: Parameters<typeof globalThis.fetch>[0],
                options?: Parameters<typeof globalThis.fetch>[1]
            ) => {
                captured = options?.signal;
                return new Promise<Response>((_resolve, reject) =>
                    options?.signal?.addEventListener(
                        'abort',
                        () => reject(new Error('cancelado')),
                        {
                            once: true
                        }
                    )
                );
            },
            { preconnect: globalThis.fetch.preconnect }
        )
    );
    setAnalyticsConsent(true);
    const pending = sendTechnicalEvent('login_session_lost');
    setAnalyticsConsent(false);
    await pending;
    expect(captured?.aborted).toBe(true);
    await sendTechnicalEvent('login_session_lost');
    expect(network).toHaveBeenCalledTimes(1);
});
