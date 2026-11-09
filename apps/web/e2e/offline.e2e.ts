import { expect, test } from '@playwright/test';

import { login, ready } from './helpers/student';

test.skip(process.env.FOLLOWW_E2E_PRODUCTION !== '1', 'PWA depende do build de produção');

test('PWA reabre turmas offline com cache cifrado e shells sem matrícula', async ({
    page,
    context
}) => {
    await login(page);
    await page.goto('/turmas');
    await ready(page);
    await expect(
        page.getByRole('heading', { name: 'ESTRUTURAS DE DADOS 1', exact: true })
    ).toBeVisible();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await expect(async () => {
        const cacheReady = await page.evaluate(async () => {
            const database = await new Promise<IDBDatabase>((resolve, reject) => {
                const request = indexedDB.open('keyval-store');
                request.addEventListener('success', () => resolve(request.result), { once: true });
                request.addEventListener(
                    'error',
                    () => reject(new Error('IndexedDB indisponível')),
                    { once: true }
                );
            });
            try {
                const read = <T>(key: string) =>
                    new Promise<T>((resolve, reject) => {
                        const request = database
                            .transaction('keyval', 'readonly')
                            .objectStore('keyval')
                            .get(key);
                        request.addEventListener('success', () => resolve(request.result), {
                            once: true
                        });
                        request.addEventListener(
                            'error',
                            () => reject(new Error('Registro indisponível')),
                            { once: true }
                        );
                    });
                const saved = await read<string>('followw-query-cache');
                const key = await read<CryptoKey>('followw-device-key-v1');
                if (!saved?.startsWith('v1.') || !key || key.extractable) return false;
                const [, iv, body] = saved.split('.');
                // oxlint-disable-next-line unicorn/consistent-function-scoping -- esta função executa no navegador
                const decode = (value: string) =>
                    Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
                const bytes = await crypto.subtle.decrypt(
                    {
                        name: 'AES-GCM',
                        iv: decode(iv),
                        additionalData: new TextEncoder().encode('followw:v1:query-cache')
                    },
                    key,
                    decode(body)
                );
                const parsed = JSON.parse(new TextDecoder().decode(bytes));
                return parsed.clientState.queries.some(
                    (query: { queryKey: unknown[]; state: { data: unknown } }) =>
                        query.queryKey[1] === '/classrooms' &&
                        Array.isArray(query.state.data) &&
                        query.state.data.length > 0
                );
            } finally {
                database.close();
            }
        });
        expect(cacheReady).toBe(true);
        expect(
            await page.evaluate(async () => {
                const names = await caches.keys();
                const cache = await caches.open(
                    names.find((name) => name.startsWith('followw-pages-')) ?? 'missing'
                );
                return Boolean(await cache.match('/turmas'));
            })
        ).toBe(true);
    }).toPass({ timeout: 15000 });
    const exposed = await page.evaluate(async () => {
        const pages = (await caches.keys()).filter((name) => name.startsWith('followw-pages-'));
        const content = await Promise.all(
            pages.map(async (name) => {
                const cache = await caches.open(name);
                const requests = await cache.keys();
                return Promise.all(
                    requests.map(async (request) => (await cache.match(request))?.text())
                );
            })
        );
        return content
            .flat()
            .some((text) => text?.includes('251000000') || text?.includes('ALUNA SIMULADA A'));
    });
    expect(exposed).toBe(false);
    await context.setOffline(true);
    await page.reload();
    await ready(page);
    await expect(
        page.getByRole('heading', { name: 'ESTRUTURAS DE DADOS 1', exact: true })
    ).toBeVisible();
    await expect(page.getByText('Você está offline', { exact: true })).toBeVisible();
    await context.setOffline(false);
});
