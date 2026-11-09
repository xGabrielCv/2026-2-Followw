import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const artifacts = fileURLToPath(new URL('../../../.local/e2e-artifacts/', import.meta.url));
const phase = process.env.FOLLOWW_VISUAL_PHASE === 'before' ? 'before' : 'after';

for (const width of [320, 360, 390, 768, 1440]) {
    for (const dark of [false, true]) {
        test(`armazenamento cabe e mantém ações acessíveis: ${width}px, ${dark ? 'escuro' : 'claro'}`, async ({
            page
        }) => {
            await page.setViewportSize({ width, height: 700 });
            await page.addInitScript(
                (theme) => localStorage.setItem('followw:theme', JSON.stringify(theme)),
                dark ? 'dark' : 'light'
            );
            await page.goto('/perfil/dados');
            await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true', {
                timeout: 15000
            });
            await page.getByRole('button', { name: /Configurar armazenamento/ }).click();
            const dialog = page.getByRole('dialog', { name: 'Configurar armazenamento' });
            await expect(dialog).toBeVisible();
            await expect(dialog).toHaveCSS('opacity', '1');
            await page.screenshot({
                path: `${artifacts}/storage-${phase}-${width}-${dark ? 'dark' : 'light'}.png`,
                animations: 'disabled'
            });
            const box = await dialog.boundingBox();
            expect(box!.x).toBeGreaterThanOrEqual(0);
            expect(box!.y).toBeGreaterThanOrEqual(0);
            expect(box!.x + box!.width).toBeLessThanOrEqual(width);
            expect(box!.y + box!.height).toBeLessThanOrEqual(701);
            expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(
                true
            );
            await Promise.all(
                ['7', '30', '90', '400'].map((value) =>
                    expect(dialog.locator(`option[value="${value}"]`)).toHaveCount(1)
                )
            );
            await dialog.getByRole('button', { name: /Apagar informações acadêmicas/ }).click();
            await expect(
                dialog.getByRole('alertdialog', { name: 'Confirmar limpeza' })
            ).toBeVisible();
            await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
            await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
            await expect(dialog.getByRole('status')).toHaveText('Prazo salvo.');
            await expect(dialog).toContainText('8 horas');
            await page.keyboard.press('Escape');
            await expect(
                page.getByText('O que você escreve pode identificar você.', { exact: true })
            ).toHaveCount(1);
            const consent = page.getByRole('checkbox', { name: 'Ajudar a melhorar o Followw' });
            await expect(consent).not.toBeChecked();
            await page.getByRole('button', { name: 'Entender as métricas de uso' }).click();
            const information = page.getByRole('dialog', { name: 'Métricas de uso' });
            await expect(information).toBeVisible();
            await expect(
                information.getByRole('heading', { name: 'O que pode ser enviado' })
            ).toBeVisible();
            await expect(
                information.getByRole('heading', { name: 'O que não é enviado' })
            ).toBeVisible();
            expect(await information.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(
                true
            );
            await page.keyboard.press('Escape');
            await expect(consent).not.toBeChecked();
            await consent.check();
            await page.reload();
            await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
            await expect(consent).toBeChecked();
            await consent.uncheck();
        });
    }
}
