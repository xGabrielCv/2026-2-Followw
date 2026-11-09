/* oxlint-disable no-await-in-loop -- a mesma aba navega pelas rotas em sequência */
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

import { ready } from './helpers/student';

const routes = [
    '/',
    '/ru',
    '/buscar',
    '/grupos',
    '/avaliacoes',
    '/professores/1000001',
    '/materiais',
    '/materiais/FGA0146',
    '/comunidade',
    '/comunidade/40000000-0000-4000-8000-000000000001',
    '/guias',
    '/guias/50000000-0000-4000-8000-000000000001',
    '/mais',
    '/calendario',
    '/simulador',
    '/estatisticas',
    '/cursos/1',
    '/suporte',
    '/perfil/dados',
    '/privacidade',
    '/login'
];
const artifacts = fileURLToPath(new URL('../../../.local/e2e-artifacts/routes/', import.meta.url));

for (const width of [320, 360, 390, 768, 1440]) {
    for (const theme of ['light', 'dark']) {
        test(`visitante navega nas rotas públicas sem overflow: ${width}px, ${theme}`, async ({
            page,
            context
        }) => {
            test.setTimeout(120_000);
            const errors: string[] = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await context.route('**/*', (route) => {
                const url = new URL(route.request().url());
                return url.protocol.startsWith('http') &&
                    !['127.0.0.1', 'localhost'].includes(url.hostname)
                    ? route.abort()
                    : route.continue();
            });
            await page.setViewportSize({ width, height: 844 });
            await page.addInitScript(
                (value) => localStorage.setItem('followw:theme', JSON.stringify(value)),
                theme
            );
            for (const path of routes) {
                const response = await page.goto(path);
                expect(response?.status(), path).toBeLessThan(400);
                await ready(page);
                await expect(page.getByText(/^(Carregando|Preparando fluxo)/)).toHaveCount(0);
                if (path === '/cursos/1')
                    await expect(page.getByRole('button', { name: /^MAT0025,/ })).toBeInViewport();
                if (path === '/professores/1000001')
                    await expect(
                        page.getByRole('button', { name: 'Ver avaliações completas', exact: true })
                    ).toBeVisible();
                await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
                await expect(async () => {
                    const fits = await page.evaluate(
                        () => document.documentElement.scrollWidth <= innerWidth
                    );
                    expect(fits, path).toBe(true);
                }).toPass({ timeout: 2000 });
                if ([320, 390, 1440].includes(width))
                    await page.screenshot({
                        path: `${artifacts}/${width}-${theme}-${path.replaceAll('/', '_') || 'home'}.png`,
                        animations: 'disabled',
                        fullPage: true
                    });
                expect(errors, path).toEqual([]);
            }
            await page.goto('/materiais/FGA0146');
            await ready(page);
            await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toHaveCount(0);
            await page.goto('/comunidade/40000000-0000-4000-8000-000000000001');
            await ready(page);
            await expect(
                page.getByRole('heading', { name: 'Como estudar estruturas de dados?' })
            ).toBeVisible();
            await expect(
                page.getByRole('button', { name: 'Marcar como resolvida', exact: true })
            ).toHaveCount(0);
            await expect(page.getByRole('textbox')).toHaveCount(0);
        });
    }
}
