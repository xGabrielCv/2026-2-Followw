import { expect, test } from '@playwright/test';

import { login, ready } from './helpers/student';

for (const [width, theme] of [
    [320, 'dark'],
    [1440, 'light']
] as const) {
    test(`simulação e leitura ficam no aparelho e separadas por conta em ${width}px ${theme}`, async ({
        page
    }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: theme });
        await login(page);
        const writes: string[] = [];
        page.on('request', (request) => {
            const path = new URL(request.url()).pathname;
            if (
                path.startsWith('/api/') &&
                !path.startsWith('/api/auth/') &&
                !['GET', 'HEAD'].includes(request.method())
            )
                writes.push(path);
        });
        await page.getByRole('link', { name: 'Simular IRA e MP' }).click();
        await expect(page).toHaveURL(/\/perfil\/simulador$/);
        const grade = () => page.locator('select[aria-label^="Menção de"]').first();
        await expect(grade()).toBeVisible();
        const original = await grade().inputValue();
        const before = await page.evaluate(() => localStorage.getItem('followw:encrypted-vault'));
        await grade().selectOption('SS');
        await expect
            .poll(() => page.evaluate(() => localStorage.getItem('followw:encrypted-vault')))
            .not.toBe(before);
        await page.reload();
        await ready(page);
        await expect(grade()).toHaveValue('SS');
        await expect(page.getByText(/Projeção indicativa/)).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
            true
        );
        await page.screenshot({
            path: `../../.local/p009-2026-11-14/simulator-${width}-${theme}.png`,
            fullPage: true
        });

        await page.goto('/turmas');
        await ready(page);
        await page.getByRole('button', { name: 'ESTRUTURAS DE DADOS 1', exact: true }).click();
        await expect(page).toHaveURL(/\/turmas\/[^/?]+/);
        const classroom = new URL(page.url()).pathname;
        await page.getByRole('tab', { name: 'Postagens', exact: true }).click();
        await page.getByRole('button', { name: /Notícia sintética de boas-vindas/ }).click();
        const previous = await page.evaluate(() => localStorage.getItem('followw:encrypted-vault'));
        await page.getByRole('button', { name: 'Marcar como lida', exact: true }).click();
        await expect(page.getByText('Lida', { exact: true })).toBeVisible();
        await expect
            .poll(() => page.evaluate(() => localStorage.getItem('followw:encrypted-vault')))
            .not.toBe(previous);
        await page.reload();
        await ready(page);
        await expect(page.getByText('Lida', { exact: true })).toBeVisible();
        expect(writes).toEqual([]);

        await page.goto('/perfil');
        await ready(page);
        await page.getByRole('button', { name: 'Desconectar', exact: true }).click();
        const loggedOut = page.waitForResponse(
            (response) =>
                new URL(response.url()).pathname === '/api/auth/sigaa' &&
                response.request().method() === 'DELETE'
        );
        await page
            .getByRole('alertdialog', { name: 'Desconectar?' })
            .getByRole('button', { name: 'Sair', exact: true })
            .click();
        expect((await loggedOut).ok()).toBe(true);
        await expect(page).toHaveURL(/\/login$/);
        await expect(page.getByRole('textbox', { name: 'Matrícula', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Editar perfil' })).not.toBeVisible();
        await login(page, '252000000');
        await page.getByRole('link', { name: 'Simular IRA e MP' }).click();
        await expect(grade()).toHaveValue(original);
        await page.goto(`${classroom}?tab=posts`);
        await ready(page);
        await expect(
            page.getByRole('button', { name: /Notícia sintética de boas-vindas/ })
        ).toBeVisible();
        await expect(page.getByText('Lida', { exact: true })).toHaveCount(0);
    });
}
