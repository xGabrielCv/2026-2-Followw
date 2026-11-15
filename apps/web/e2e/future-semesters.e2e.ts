import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

import { ready } from './helpers/student';

const artifacts = fileURLToPath(new URL('../../../.local/e2e-artifacts/', import.meta.url));

for (const [width, theme] of [
    [320, 'dark'],
    [1440, 'light']
] as const) {
    test(`busca futura e resumo de privacidade em ${width}px ${theme}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: theme });
        await page.clock.install({ time: new Date('2033-09-20T15:00:00Z') });
        let semesters = ['2034.1', '2033.2'];
        await page.route('**/api/public/subjects/semesters', (route) =>
            route.fulfill({ json: semesters })
        );
        await page.route('**/api/public/config', async (route) => {
            const response = await route.fetch();
            const json = await response.json();
            json.calendar = {
                '2033.2': {
                    semester: '2033.2',
                    name: 'Segundo semestre',
                    period: { start: '2033-08-08', end: '2033-12-15' },
                    classes: { start: '2033-08-08', end: '2033-12-15', instructional_days: 100 },
                    events: []
                }
            };
            json.alert.enabled = false;
            await route.fulfill({ response, json });
        });
        await page.goto('/buscar?q=historia&category=classrooms');
        await ready(page);
        const select = page.getByLabel('Semestre da oferta', { exact: true });
        await expect(select).toHaveValue('2034.1');
        const currentRequest = page.waitForRequest(
            (request) =>
                request.url().includes('/api/public/search?') &&
                new URL(request.url()).searchParams.get('semester') === '2033.2'
        );
        await select.selectOption('2033.2');
        await currentRequest;
        await expect(
            page.getByText('Nenhuma matéria encontrada. Tente mudar a busca.')
        ).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
            true
        );
        await page.screenshot({
            path: `${artifacts}/future-search-${width}-${theme}.png`,
            fullPage: true
        });

        semesters = ['2033.2'];
        await page.reload();
        await ready(page);
        await expect(select.locator('option[value="2034.1"]')).toBeDisabled();
        semesters = [];
        await page.reload();
        await ready(page);
        await expect(
            page.getByText(/A oferta do semestre atual e do próximo ainda não foi coletada/)
        ).toBeVisible();

        await page.goto('/buscar?category=internships&q=historia');
        await ready(page);
        await expect(page.getByText('Entre com o SIGAA')).toBeVisible();
        await page.goto('/login');
        await ready(page);
        await expect(
            page.locator('li').filter({ hasText: 'Credenciais em cookies cifrados' })
        ).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
            true
        );
        await page.screenshot({
            path: `${artifacts}/login-privacy-${width}-${theme}.png`,
            fullPage: true
        });
    });
}
