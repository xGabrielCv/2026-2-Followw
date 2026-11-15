import { expect, test } from '@playwright/test';

import { ready } from './helpers/student';

test('ativação, desativação e campanhas sucessivas chegam à aba aberta e não publicam nada sozinhas', async ({
    page
}) => {
    await page.clock.install();
    let enabled = false;
    let campaign = 'teste-a';
    await page.route('**/api/public/config', async (route) => {
        const response = await route.fetch();
        const json = await response.json();
        json.alert = {
            ...json.alert,
            enabled,
            always_on: true,
            trigger_id: campaign,
            title: 'Lembrete sintético de ativação',
            message: 'Avaliação opcional para testar a ativação.'
        };
        await route.fulfill({ response, json });
    });
    await page.goto('/login');
    await ready(page);
    await page.getByRole('textbox', { name: 'Matrícula', exact: true }).fill('251000000');
    await page.getByLabel('Senha do SIGAA', { exact: true }).fill('simulada123');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL(/\/perfil$/);
    await expect(page.getByRole('button', { name: 'Editar perfil', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const writes: string[] = [];
    page.on('request', (request) => {
        if (request.url().includes('/api/') && !['GET', 'HEAD'].includes(request.method()))
            writes.push(new URL(request.url()).pathname);
    });
    enabled = true;
    await page.clock.fastForward(61_000);
    const dialog = page.getByRole('dialog', { name: 'Lembrete sintético de ativação' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    campaign = 'teste-b';
    await page.clock.fastForward(61_000);
    await expect(dialog).toBeVisible();
    enabled = false;
    await page.clock.fastForward(61_000);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(writes).toEqual([]);
});
