/* oxlint-disable no-await-in-loop -- a mesma página percorre matérias e larguras em sequência */
import { expect, test } from '@playwright/test';

import { overflowingText } from './helpers/overflow';
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
    // só o texto de horas de cada semestre (o rótulo "2027.1" fica colado nele no textContent)
    const hours = await simulated
        .locator(':scope > li > div > span:nth-child(2)')
        .allTextContents();
    expect(hours.length).toBeGreaterThan(0);
    expect(hours.every((text) => Number.parseInt(text, 10) <= 120)).toBe(true);
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

test('simulador permite prévia e exige pré-requisitos apenas quando solicitado', async ({
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
    await expect(page.getByText('Opção 1', { exact: true })).toBeVisible();
    await expect(page.getByText(/Confira os pré-requisitos no SIGAA/)).toBeVisible();
    await page.getByRole('checkbox', { name: /Exigir requisitos confirmados/ }).check();
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
    await page.getByRole('checkbox', { name: /Exigir requisitos confirmados/ }).check();
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

test('simulador contém nomes extensos e opções no celular, modo forçado e desktop', async ({
    page
}) => {
    await login(page);
    for (const code of ['MAT0025', 'FGA0158']) {
        await page.goto(`/buscar?q=${code}&semester=2027.1`);
        await ready(page);
        await page.getByRole('button', { name: new RegExp(`^${code} `) }).click();
        await page
            .getByRole('button', { name: `Adicionar à grade: ${code}, turma 01`, exact: true })
            .click();
    }
    await page.goto('/simulador');
    await ready(page);
    const section = page
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: 'Sugerir grades', exact: true }) });
    await section.getByRole('button', { name: 'Sugerir grades', exact: true }).click();
    await expect(page.getByText('Opção 1', { exact: true })).toBeVisible();
    // Dado de teste extremo, sem alterar o catálogo ou o armazenamento do aluno.
    await section
        .locator('label .font-medium')
        .first()
        .evaluate((element) => {
            element.textContent =
                'ENGENHARIA DE PRODUTO DE SOFTWARE ' + 'NomeSemEspaços'.repeat(20);
        });
    await page.setViewportSize({ width: 320, height: 900 });
    const noWrap = await page.addStyleTag({ content: 'body { overflow-wrap: normal; }' });
    expect((await overflowingText(page, 'section:has(h2):has(fieldset)')).length).toBeGreaterThan(
        0
    );
    await noWrap.evaluate((element) => element.parentNode?.removeChild(element));
    for (const [width, forced] of [
        [320, false],
        [390, false],
        [1440, true],
        [1440, false]
    ] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate((mobile) => {
            if (mobile) document.documentElement.dataset.layout = 'mobile';
            else delete document.documentElement.dataset.layout;
        }, forced);
        expect(await overflowingText(page, 'section:has(h2):has(fieldset)')).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
            true
        );
        await page.screenshot({
            path: `../../.local/e2e-artifacts/p021-planner-${width}-${forced}.png`,
            fullPage: true
        });
    }
});
