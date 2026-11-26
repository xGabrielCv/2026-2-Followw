/* oxlint-disable no-await-in-loop -- mesma aba percorre dispositivos, temas e seções em sequência */
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

import { setupOwner } from './helpers/admin';
import { overflowingText } from './helpers/overflow';
import { login, ready } from './helpers/student';

const artifacts = fileURLToPath(
    new URL('../../../.local/e2e-artifacts/multi-device/', import.meta.url)
);

const webViewports = [
    { width: 320, height: 568, label: '320x568' },
    { width: 360, height: 800, label: '360x800' },
    { width: 390, height: 844, label: '390x844' },
    { width: 412, height: 915, label: '412x915' },
    { width: 768, height: 1024, label: '768x1024' },
    { width: 1024, height: 768, label: '1024x768' },
    { width: 1440, height: 900, label: '1440x900' }
];

const adminViewports = [
    { width: 320, height: 568, label: '320x568' },
    { width: 360, height: 800, label: '360x800' },
    { width: 390, height: 844, label: '390x844' },
    { width: 768, height: 1024, label: '768x1024' },
    { width: 1440, height: 900, label: '1440x900' }
];

test('painel admin, banner operacional, plano de ensino e modos forçados em múltiplos dispositivos', async ({
    page
}) => {
    test.setTimeout(240_000);
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(error.message));
    page.on('console', (entry) => {
        if (entry.type() === 'error' && /content security|refused to|uncaught/i.test(entry.text()))
            failures.push(entry.text());
    });

    // 1. Painel administrativo (/api/admin) em 320px..1440px, claro e escuro
    await setupOwner(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/api/admin');
    await expect(page.locator('#app')).toHaveClass('ready');

    const sections: { view: string; expectedText: string }[] = [
        { view: 'overview', expectedText: 'Visão geral' },
        { view: 'usage', expectedText: 'Exportar CSV' },
        { view: 'operations', expectedText: 'Pool HTTP SIGAA' },
        { view: 'breakdown', expectedText: 'Distribuições' },
        { view: 'sync', expectedText: 'Sincronização e catálogos' },
        { view: 'moderation', expectedText: 'Denúncias e pedidos de exclusão' },
        { view: 'data', expectedText: 'Dados' },
        { view: 'support', expectedText: 'Chamados de suporte' },
        { view: 'accounts', expectedText: 'Equipe administrativa' },
        { view: 'system', expectedText: 'Manutenção e limpeza de efêmeros' },
        { view: 'audit', expectedText: 'Exportar CSV' },
        { view: 'logs', expectedText: 'Registros técnicos' },
        { view: 'limits', expectedText: 'Limites da comunidade' },
        { view: 'demo', expectedText: 'Dados de demonstração' },
        { view: 'database', expectedText: 'Banco de dados · CloudBeaver Community' },
        { view: 'security', expectedText: 'Minhas sessões ativas' }
    ];

    for (const section of sections) {
        await page.locator(`nav button[data-view="${section.view}"]`).click();
        await expect(page.locator('#main')).toContainText(section.expectedText);
        await expect(page.locator('#main')).not.toContainText('Não foi possível carregar');
        for (const vp of adminViewports) {
            await page.setViewportSize({ width: vp.width, height: vp.height });
            const fits = await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth
            );
            expect(fits, `admin #${section.view} em ${vp.label}`).toBe(true);
        }
    }

    await page.setViewportSize({ width: 320, height: 568 });
    await page.getByRole('button', { name: 'Alternar tema' }).click();
    await page.locator('nav button[data-view="operations"]').click();
    await expect(page.locator('#main')).toContainText('Aviso operacional público');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
    );
    await page.screenshot({
        path: `${artifacts}/admin-operations-320-dark.png`,
        fullPage: true
    });
    const navToggle = page.locator('#nav-toggle');
    await expect(navToggle).toBeVisible();
    await navToggle.click();
    await expect(navToggle).toHaveAttribute('aria-expanded', 'false');
    await navToggle.click();
    await expect(navToggle).toHaveAttribute('aria-expanded', 'true');

    // Publica aviso operacional público com palavra longa e encerra sessão admin
    const saveBanner = await page.request.put('/api/admin/api/operations/banner', {
        headers: { 'X-Admin-Request': '1' },
        data: {
            enabled: true,
            level: 'warning',
            title: 'Manutenção programada do SIGAA',
            message:
                'A origem institucional poderá oscilar hoje; dados já abertos seguem salvos localmente (referência-longa-sem-espaço-0123456789abcdef0123456789abcdef).',
            expires_at: null
        }
    });
    expect(saveBanner.status()).toBe(200);
    await page.request.post('/api/admin/api/logout', { headers: { 'X-Admin-Request': '1' } });

    // 2. App web: banner operacional público em 320px + plano de ensino em 7 viewports e 2 temas
    await page.setViewportSize({ width: 320, height: 568 });
    await login(page);

    const banner = page.getByRole('complementary', { name: 'Aviso operacional' });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Manutenção programada do SIGAA');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
    );
    expect(await overflowingText(page)).toEqual([]);
    await page.screenshot({
        path: `${artifacts}/banner-320.png`,
        animations: 'disabled'
    });
    await banner.getByRole('button', { name: 'Dispensar aviso' }).click();
    await expect(banner).toHaveCount(0);

    await page.goto('/turmas/AAA');
    await ready(page);
    const planLink = page.getByRole('link', { name: /Plano de ensino/i });
    await expect(planLink).toBeVisible();
    await planLink.click();
    await expect(page).toHaveURL(/\/turmas\/AAA\/plano-de-ensino$/);
    await ready(page);
    await expect(
        page.getByRole('heading', { name: 'ESTRUTURAS DE DADOS 1', exact: true })
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Metodologia', exact: true })).toBeVisible();
    await expect(
        page.getByRole('heading', { name: 'Cronograma de aulas', exact: true })
    ).toBeVisible();

    for (const vp of webViewports) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        for (const theme of ['light', 'dark'] as const) {
            await page.evaluate((value) => {
                localStorage.setItem('followw:theme', JSON.stringify(value));
                document.documentElement.dataset.theme = value;
                document.documentElement.classList.toggle('dark', value === 'dark');
            }, theme);
            await expect(async () => {
                const fits = await page.evaluate(
                    () => document.documentElement.scrollWidth <= innerWidth
                );
                expect(fits, `plano ${vp.label} ${theme}`).toBe(true);
            }).toPass({ timeout: 2000 });
            expect(await overflowingText(page), `texto plano ${vp.label} ${theme}`).toEqual([]);
            const tableVisible = await page.locator('table').first().isVisible();
            expect(tableVisible, `tabela cronograma em ${vp.label}`).toBe(vp.width >= 1024);
        }
        if ([320, 390, 1440].includes(vp.width)) {
            await page.screenshot({
                path: `${artifacts}/teaching-plan-${vp.label}.png`,
                animations: 'disabled',
                fullPage: true
            });
        }
    }

    // 3. Modo celular forçado em tela de computador (1440x900)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => {
        localStorage.setItem('followw:layout', JSON.stringify('mobile'));
        document.documentElement.dataset.layout = 'mobile';
    });
    await page.reload();
    await ready(page);
    await expect(page.locator('html')).toHaveAttribute('data-layout', 'mobile');
    expect(await page.locator('table').first().isVisible()).toBe(false);
    const forcedPlanArticleWidth = await page
        .getByRole('article', { name: 'Plano de ensino', exact: true })
        .evaluate((el) => el.getBoundingClientRect().width);
    expect(forcedPlanArticleWidth).toBeLessThanOrEqual(460);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
    );

    await page.goto('/cursos/1');
    await ready(page);
    await expect(page.getByRole('button', { name: /^MAT0025,/ })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Legenda dos estados acadêmicos' })).toHaveCount(0);
    const forcedFlowMainWidth = await page
        .locator('main')
        .evaluate((el) => el.getBoundingClientRect().width);
    expect(forcedFlowMainWidth).toBeLessThanOrEqual(460);
    // Abre os modais de PAS e de Estatísticas do curso em modo celular forçado e confirma centralização + exportação
    const pasTrigger = page.getByRole('button', { name: /Nota de corte PAS/ });
    await expect(pasTrigger).toBeVisible();
    await pasTrigger.click();
    const pasDialog = page.getByRole('dialog');
    await expect(pasDialog).toBeVisible();
    await expect(pasDialog.getByRole('button', { name: 'Exportar CSV' })).toBeVisible();
    await expect(pasDialog.getByRole('button', { name: 'Exportar JSON' })).toBeVisible();
    const pasBox = await pasDialog.boundingBox();
    expect(pasBox).not.toBeNull();
    if (pasBox) {
        expect(pasBox.width).toBeLessThanOrEqual(430);
        expect(Math.abs(pasBox.x + pasBox.width / 2 - 720)).toBeLessThan(30);
    }
    await page.screenshot({
        path: `${artifacts}/pas-dialog-forced-mobile-1440.png`,
        animations: 'disabled'
    });
    await pasDialog.getByRole('button', { name: 'Fechar' }).first().click();
    await expect(pasDialog).toBeHidden();

    const statsTrigger = page.getByRole('button', { name: /Estatísticas do curso/ });
    await expect(statsTrigger).toBeVisible();
    await statsTrigger.click();
    const statsDialog = page.getByRole('dialog');
    await expect(statsDialog).toBeVisible();
    await expect(statsDialog).toContainText('Indicadores DPO/UnB');
    await expect(statsDialog.getByRole('button', { name: 'Exportar CSV' })).toBeVisible();
    const statsBox = await statsDialog.boundingBox();
    expect(statsBox).not.toBeNull();
    if (statsBox) {
        expect(statsBox.width).toBeLessThanOrEqual(430);
        expect(Math.abs(statsBox.x + statsBox.width / 2 - 720)).toBeLessThan(30);
    }
    await page.screenshot({
        path: `${artifacts}/stats-dialog-forced-mobile-1440.png`,
        animations: 'disabled'
    });
    await statsDialog.getByRole('button', { name: 'Fechar' }).first().click();
    await expect(statsDialog).toBeHidden();
    await page.screenshot({
        path: `${artifacts}/flow-forced-mobile-1440.png`,
        animations: 'disabled'
    });

    // 4. Modo computador forçado em tela estreita (390x844)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
        localStorage.setItem('followw:layout', JSON.stringify('desktop'));
        document.documentElement.dataset.layout = 'desktop';
    });
    await page.goto('/turmas/AAA/plano-de-ensino');
    await ready(page);
    await expect(page.locator('html')).toHaveAttribute('data-layout', 'desktop');
    expect(await page.locator('table').first().isVisible()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
    );
    await page.screenshot({
        path: `${artifacts}/teaching-plan-forced-desktop-390.png`,
        animations: 'disabled',
        fullPage: true
    });

    // 5. Volta para automático e confere turma sem plano cadastrado (BBB): o atalho não aparece e acesso direto volta à turma
    await page.evaluate(() => {
        localStorage.removeItem('followw:layout');
        delete document.documentElement.dataset.layout;
    });
    await page.goto('/turmas/BBB');
    await ready(page);
    await expect(page.getByRole('link', { name: /Plano de ensino/i })).toHaveCount(0);
    await page.goto('/turmas/BBB/plano-de-ensino');
    await expect(page).toHaveURL(/\/turmas\/BBB$/);

    // 6. Confere modal de Fonte das estatísticas públicas em Perfil > Conta
    await page.goto('/perfil');
    await ready(page);
    const sourceRow = page.getByRole('button', { name: /Fonte das estatísticas públicas/ });
    await expect(sourceRow).toBeVisible();
    await expect(sourceRow).toContainText('Média combinada');
    await sourceRow.click();
    const sourceDialog = page.getByRole('dialog');
    await expect(sourceDialog).toBeVisible();
    await sourceDialog.getByRole('button', { name: /Só Tamburetei/ }).click();
    await sourceDialog.getByRole('button', { name: 'Aplicar' }).click();
    await expect(sourceDialog).toBeHidden();
    await expect(sourceRow).toContainText('Só Tamburetei');
    expect(failures).toEqual([]);
});
