import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

import { login, ready } from './helpers/student';

const artifacts = fileURLToPath(new URL('../../../.local/e2e-artifacts/', import.meta.url));

test('grade semanal e calendário de frequência preservam o celular e os dados locais', async ({
    page
}) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await login(page);
    await page.goto('/turmas');
    await ready(page);
    const grid = page.getByRole('region', { name: /Grade semanal/ });
    await expect(grid).toBeVisible();
    await page.screenshot({ path: `${artifacts}/upstream-turmas-desktop.png`, fullPage: true });
    await grid.getByRole('button').first().click();
    await expect(page).toHaveURL(/\/turmas\//);
    const frequency = page.getByRole('tab', { name: 'Frequência', exact: true });
    if (await frequency.isVisible()) await frequency.click();
    await page.getByRole('button', { name: 'Calendário de frequência', exact: true }).click();
    const calendar = page.getByRole('region', { name: 'Calendário de frequência', exact: true });
    await expect(calendar).toBeVisible();
    await calendar.locator('button[aria-pressed]:not([disabled])').first().click();
    await expect(calendar.getByRole('button', { name: 'Mostrar todas as aulas' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
    );
    await page.screenshot({ path: `${artifacts}/upstream-frequencia-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
    );
    await page.screenshot({ path: `${artifacts}/upstream-frequencia-mobile.png`, fullPage: true });
    await page.goto('/turmas');
    await ready(page);
    await expect(page.getByRole('region', { name: /Grade semanal/ })).not.toBeVisible();
});
