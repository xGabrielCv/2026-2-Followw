import { expect, test } from '@playwright/test';

import { login, ready, syntheticPdf } from './helpers/student';

test('material é enviado sem cookie acadêmico e PDF vira pixels com recursos locais', async ({
    page,
    context
}) => {
    const unexpected: string[] = [];
    await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (!['127.0.0.1', 'localhost'].includes(url.hostname) && url.protocol.startsWith('http')) {
            unexpected.push(url.origin);
            return route.abort();
        }
        return route.continue();
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto('/materiais/FGA0146');
    await ready(page);
    await page.getByRole('button', { name: 'Enviar', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Enviar material' });
    await dialog.locator('input[type=file]').setInputFiles({
        name: 'documento-sintetico.pdf',
        mimeType: 'application/pdf',
        buffer: syntheticPdf()
    });
    await dialog.getByLabel('Título', { exact: true }).fill('PDF sintético para prévia');
    await dialog.getByRole('checkbox', { name: /O arquivo não tem meu nome/ }).check();
    const uploaded = page.waitForRequest(
        (request) => request.method() === 'POST' && request.url().endsWith('/api/materials/FGA0146')
    );
    await dialog.getByRole('button', { name: 'Enviar material', exact: true }).click();
    const headers = await (await uploaded).allHeaders();
    expect(headers.cookie).toBeUndefined();
    expect(headers['x-followw-permit']).toBeTruthy();
    await expect(dialog).not.toBeVisible();
    await page.getByRole('button', { name: 'Abrir', exact: true }).first().click();
    const preview = page.getByRole('dialog', { name: 'PDF sintético para prévia' });
    await expect(preview.locator('canvas')).toHaveAttribute('data-rendered', 'true', {
        timeout: 15000
    });
    await expect(preview.getByText('Página 1 de 1', { exact: true })).toBeVisible();
    expect(await preview.locator('iframe, embed, object, a[href^="http"]').count()).toBe(0);
    const size = await preview
        .locator('canvas')
        .evaluate((element) =>
            element instanceof HTMLCanvasElement ? element.width * element.height : 0
        );
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThanOrEqual(4_000_000);
    expect(unexpected).toEqual([]);
    expect(await preview.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true
    );
    await page.keyboard.press('Escape');
    await expect(preview).not.toBeVisible();
});

test('scanner ativo recusa payload suspeito e aceita PDF limpo sem vazar origem', async ({
    page
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto('/materiais/FGA0146');
    await ready(page);
    await page.getByRole('button', { name: 'Enviar', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Enviar material' });
    const eicarHead = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR';
    const eicarTail = '-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
    await dialog.locator('input[type=file]').setInputFiles({
        name: 'suspeito.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(`%PDF-1.4\n% ${eicarHead}${eicarTail}\n%%EOF`, 'utf-8')
    });
    await dialog.getByLabel('Título', { exact: true }).fill('Tentativa com assinatura suspeita');
    await dialog.getByRole('checkbox', { name: /O arquivo não tem meu nome/ }).check();
    const rejected = page.waitForResponse(
        (response) =>
            response.request().method() === 'POST' &&
            response.url().endsWith('/api/materials/FGA0146')
    );
    await dialog.getByRole('button', { name: 'Enviar material', exact: true }).click();
    expect((await rejected).status()).toBe(422);
    await expect(dialog).toBeVisible();

    await dialog.locator('input[type=file]').setInputFiles({
        name: 'limpo.pdf',
        mimeType: 'application/pdf',
        buffer: syntheticPdf('Limpo apos scanner')
    });
    await dialog.getByLabel('Título', { exact: true }).fill('PDF limpo após recusa');
    const accepted = page.waitForResponse(
        (response) =>
            response.request().method() === 'POST' &&
            response.url().endsWith('/api/materials/FGA0146')
    );
    await dialog.getByRole('button', { name: 'Enviar material', exact: true }).click();
    expect((await accepted).status()).toBe(201);
    await expect(dialog).not.toBeVisible();
});
