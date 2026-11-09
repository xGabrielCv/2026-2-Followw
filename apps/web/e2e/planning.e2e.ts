import { expect, test } from '@playwright/test';

import { login, ready } from './helpers/student';

test('planejamento inclui optativa, respeita carga e restaura preferências locais', async ({
    page
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto('/cursos/1/estatisticas');
    await ready(page);
    await expect(page.getByText('Planejar a formatura', { exact: true })).toBeVisible();
    await page.getByText('Incluir optativas e componentes complementares', { exact: true }).click();
    await page.getByRole('checkbox', { name: /FGA0001/ }).check();
    await page.getByLabel('Matérias por semestre', { exact: true }).selectOption('4');
    await page.getByLabel('Horas por semestre', { exact: true }).fill('120');
    await expect(page.getByRole('list', { name: 'Semestres simulados' })).toContainText('FGA0001');
    const simulated = page.getByRole('list', { name: 'Semestres simulados' });
    const rows = await simulated.locator(':scope > li').allTextContents();
    expect(rows.every(text => Number(/(\d+)h/.exec(text)?.[1]) <= 120)).toBe(true);
    await page.reload();
    await ready(page);
    await expect(page.getByLabel('Matérias por semestre', { exact: true })).toHaveValue('4');
    await expect(page.getByLabel('Horas por semestre', { exact: true })).toHaveValue('120');
    await page.getByText('Incluir optativas e componentes complementares', { exact: true }).click();
    await expect(page.getByRole('checkbox', { name: /FGA0001/ })).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
    );
});

test('simulador usa worker local e só aceita pré-requisito conhecido depois de concluído', async ({
    page
}) => {
    await login(page);
    await page.goto('/buscar?q=MAT0025&semester=2027.1');
    await ready(page);
    await page.getByRole('button', { name: /^MAT0025 / }).click();
    await page
        .getByRole('button', { name: 'Adicionar à grade: MAT0025, turma 01', exact: true })
        .click();
    await page.goto('/buscar?q=FGA0158&semester=2027.1');
    await ready(page);
    await page.getByRole('button', { name: /^FGA0158 / }).click();
    await page
        .getByRole('button', { name: 'Adicionar à grade: FGA0158, turma 01', exact: true })
        .click();
    await page.goto('/simulador');
    await ready(page);
    await page.getByRole('button', { name: 'Sugerir grades', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('pré-requisitos');
    await page.goto('/cursos/1');
    await ready(page);
    await page.getByRole('button', { name: /^FGA0146,/ }).click();
    await page.getByRole('button', { name: 'Marcar como concluída', exact: true }).click();
    await expect(
        page.getByRole('button', { name: 'Desmarcar conclusão manual', exact: true })
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/simulador');
    await ready(page);
    const workers: string[] = [];
    page.on('worker', (worker) => workers.push(worker.url()));
    await page.getByRole('button', { name: 'Sugerir grades', exact: true }).click();
    await expect(page.getByText('Opção 1', { exact: true })).toBeVisible();
    expect(workers.some((url) => url.includes('schedule-optimizer.worker'))).toBe(true);
    await page.getByRole('button', { name: 'Usar esta grade', exact: true }).first().click();
    await expect(page.getByText('Opção 1', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
    );
});
