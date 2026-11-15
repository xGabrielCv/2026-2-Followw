import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

import { setupOwner } from './helpers/admin';

test('CloudBeaver real exige Owner, abre canal de eventos e mostra interface em português', async ({
    page
}) => {
    test.skip(
        process.env.FOLLOWW_E2E_CLOUDBEAVER !== '1',
        'Exige instalação local explícita do CloudBeaver.'
    );
    expect((await page.request.get('/api/admin/database/')).status()).toBe(401);
    await setupOwner(page);
    await page.goto('/api/admin#database');
    await expect(
        page.getByRole('link', { name: 'Abrir CloudBeaver com autenticação adicional' })
    ).toHaveAttribute('href', '/api/admin/database/');
    const loaded = page.waitForResponse(
        (response) =>
            response.url().includes('/api/admin/database/api/gql') &&
            response.request().method() === 'POST'
    );
    const events: string[] = [];
    page.on('websocket', (socket) => {
        socket.on('framereceived', ({ payload }) => {
            const data = typeof payload === 'string' ? payload : payload.toString();
            if (data.includes('cb_session_websocket_connected')) events.push(data);
        });
    });
    await page.goto('/api/admin/database/');
    expect((await loaded).status()).toBe(200);
    await expect.poll(() => events.length, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(page.getByText(/^(Entrar|Autenticar)$/).first()).toBeVisible();
    await expect(page.getByLabel('Nome de usuário', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Senha do usuário', { exact: true })).toBeVisible();
    await expect.poll(() => page.getByRole('button').count()).toBeGreaterThan(0);
    await page.screenshot({
        path: fileURLToPath(
            new URL('../../../.local/e2e-artifacts/cloudbeaver-interface.png', import.meta.url)
        ),
        fullPage: true
    });
    await page.request.post('/api/admin/api/logout', { headers: { 'X-Admin-Request': '1' } });
    expect((await page.request.get('/api/admin/database/')).status()).toBe(401);
});
