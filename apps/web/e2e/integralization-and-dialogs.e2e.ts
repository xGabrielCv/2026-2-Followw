import { devices, expect, test } from '@playwright/test';

import { overflowingText } from './helpers/overflow';
import { login, ready } from './helpers/student';

for (const device of ['iPhone SE', 'iPhone 13', 'Pixel 7', 'Galaxy S9+', 'iPad Mini']) {
    test.describe(device, () => {
        const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices[device];
        test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });
        test('janela da grade fica na área visível, rola e mantém ações acessíveis', async ({
            page
        }) => {
            await login(page);
            await page.goto('/buscar?q=MAT0025&semester=2027.1');
            await ready(page);
            await page.getByRole('button', { name: /^MAT0025 / }).click();
            await page
                .getByRole('button', { name: 'Adicionar à grade: MAT0025, turma 01', exact: true })
                .click();
            await page.getByRole('button', { name: 'Ver grade', exact: true }).click();
            const dialog = page.getByRole('dialog', { name: 'Minha grade semanal' });
            await expect(dialog).toBeVisible();
            expect(await overflowingText(page, '[data-slot="dialog-content"]')).toEqual([]);
            const fits = async () =>
                dialog.evaluate((element) => {
                    const rect = element.getBoundingClientRect();
                    const visibleViewport = window.visualViewport;
                    return (
                        rect.left >= (visibleViewport?.offsetLeft ?? 0) &&
                        rect.right <=
                            (visibleViewport?.width ?? innerWidth) +
                                (visibleViewport?.offsetLeft ?? 0) +
                                1 &&
                        rect.top >= 0 &&
                        rect.bottom <= innerHeight + 1
                    );
                });
            await expect.poll(fits).toBe(true);
            await page.screenshot({
                path: `../../.local/e2e-artifacts/p022-${device.replaceAll(' ', '-')}.png`
            });
            await page.setViewportSize({ width: 844, height: 390 });
            await expect.poll(fits).toBe(true);
            await page.setViewportSize({ width: 1440, height: 900 });
            await page.evaluate(() => {
                document.documentElement.dataset.layout = 'mobile';
            });
            await expect
                .poll(() => dialog.evaluate((e) => e.getBoundingClientRect().width))
                .toBeLessThanOrEqual(416);
            await expect.poll(fits).toBe(true);
            if (device === 'iPhone SE') {
                const previousStyle = await dialog.evaluate((element) => {
                    const previous = element.getAttribute('style');
                    if (element instanceof HTMLElement) {
                        element.style.setProperty('width', '48rem', 'important');
                        element.style.setProperty('max-width', 'none', 'important');
                    }
                    return previous;
                });
                await expect
                    .poll(() => dialog.evaluate((e) => e.getBoundingClientRect().width))
                    .toBeGreaterThan(416);
                await dialog.evaluate((element, previous) => {
                    if (previous == null) element.removeAttribute('style');
                    else element.setAttribute('style', previous);
                }, previousStyle);
                await expect
                    .poll(() => dialog.evaluate((e) => e.getBoundingClientRect().width))
                    .toBeLessThanOrEqual(416);
            }
            await dialog
                .getByRole('button', { name: 'Baixar imagem', exact: true })
                .scrollIntoViewIfNeeded();
            await expect(
                dialog.getByRole('button', { name: 'Baixar imagem', exact: true })
            ).toBeInViewport();
            await dialog.getByRole('button', { name: 'Fechar grade semanal' }).click();
            await expect(dialog).not.toBeVisible();
        });
    });
}

test('integralização abre dentro do simulador, calcula resultados e não altera IRA', async ({
    page
}) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.route('**/api/me', async (route) => {
        const response = await route.fetch();
        const profile = await response.json();
        if (response.ok() && profile) {
            profile.workload = {
                total: 1000,
                pending_mandatory: 500,
                pending_optional: 100,
                pending_complementary: 50
            };
            profile.integralization = 35;
        }
        await route.fulfill({ response, json: profile });
    });
    await login(page);
    await page.getByRole('link', { name: 'Simular IRA e MP', exact: true }).click();
    await ready(page);
    const open = page.getByRole('button', { name: 'Calcular integralização futura', exact: true });
    await open.scrollIntoViewIfNeeded();
    await open.click();
    await expect(
        page.getByRole('heading', { name: 'Calcular integralização futura', exact: true })
    ).toBeVisible();
    await expect(page.getByText('Integralização atual', { exact: true })).toBeVisible();
    const results = page.getByRole('region', { name: 'Resultados simulados para integralização' });
    const selects = results.getByRole('combobox', { name: 'Resultado', exact: true });
    expect(await selects.count()).toBeGreaterThan(0);
    await selects.first().click();
    await page.getByRole('option', { name: 'Aprovado', exact: true }).click();
    const category = results.getByRole('combobox', { name: 'Categoria para a simulação' }).first();
    await category.click();
    await page.getByRole('option', { name: 'Obrigatória', exact: true }).click();
    await expect(page.getByText(/60h adicionais aproveitáveis/)).toBeVisible();
    await page.screenshot({
        path: '../../.local/e2e-artifacts/p022-integralization-mobile.png',
        fullPage: true
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    expect(await overflowingText(page)).toEqual([]);
    await page.screenshot({
        path: '../../.local/e2e-artifacts/p022-integralization-desktop.png',
        fullPage: true
    });
    await page.setViewportSize({ width: 320, height: 568 });
    await selects.first().click();
    await page.getByRole('option', { name: 'Reprovado', exact: true }).click();
    await expect(page.getByText(/0h adicionais aproveitáveis/)).toBeVisible();
    expect(await overflowingText(page)).toEqual([]);
    await page.getByRole('button', { name: 'Voltar ao simulador de IRA e MP' }).click();
    await expect(page.getByText('IRA atual', { exact: true })).toBeVisible();
});
