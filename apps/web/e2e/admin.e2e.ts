import { expect, test } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const password = 'senha-sintetica-apenas-para-e2e';
const artifacts = fileURLToPath(new URL('../../../.local/e2e-artifacts/', import.meta.url));

function totp(secret: string) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const bits = Array.from(secret)
        .map((char) => alphabet.indexOf(char).toString(2).padStart(5, '0'))
        .join('');
    const bytes = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
    const digest = createHmac('sha1', bytes).update(counter).digest();
    const offset = digest[digest.length - 1] & 15;
    return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

test('Owner cadastra MFA, administra equipe e moderador só acessa o permitido', async ({
    page
}) => {
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(error.message));
    page.on('console', (entry) => {
        if (entry.type() === 'error' && /content security|refused to|uncaught/i.test(entry.text()))
            failures.push(entry.text());
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/api/admin');
    await expect(page.getByRole('heading', { name: 'Criar o acesso do Owner' })).toBeVisible();
    await page.getByLabel('Pseudônimo', { exact: true }).fill('owner-sintetico');
    await page.getByLabel('Senha', { exact: true }).fill(password);
    await page.getByLabel('Repita a senha').fill(password);
    await page.getByRole('button', { name: 'Cadastrar e configurar MFA' }).click();
    await expect(page.getByRole('heading', { name: 'Configure seu autenticador' })).toBeVisible();
    expect((await page.request.get('/api/admin/api/overview')).status()).toBe(401);
    await page.getByText('Configurar sem QR', { exact: true }).click();
    const secret = (await page.locator('#qr-area code').textContent())!;
    await expect(page.getByAltText('QR para cadastrar o autenticador')).toBeVisible();
    await page.getByLabel('Código do autenticador ou recuperação').fill(totp(secret));
    await page.getByRole('button', { name: 'Confirmar autenticador' }).click();
    await expect(
        page.getByRole('heading', { name: 'Guarde seus códigos de recuperação' })
    ).toBeVisible();
    await expect(page.locator('.recovery-codes code')).toHaveCount(10);
    await page.getByRole('button', { name: 'Guardei os códigos' }).click();
    await expect(page.locator('#app')).toHaveClass('ready');
    await expect(page.locator('#main')).toContainText('Visão geral');
    expect(await page.locator('body').textContent()).not.toContain(secret);
    await page.screenshot({ path: `${artifacts}/admin-desktop-light.png`, fullPage: true });
    await page.getByRole('button', { name: 'Alternar tema' }).click();
    await page.screenshot({ path: `${artifacts}/admin-desktop-dark.png`, fullPage: true });
    await page.getByRole('button', { name: 'Sistema e armazenamento', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Saúde e latência' })).toBeVisible();
    await expect(page.locator('#main')).toContainText('PostgreSQL respondeu');
    await page.getByRole('button', { name: 'Redefinir estatísticas…' }).click();
    const reset = page.getByRole('dialog', { name: 'Detalhes' });
    await expect(reset).toContainText('Não será apagado');
    await expect(reset).toContainText('log de auditoria');
    await reset.getByRole('button', { name: 'Redefinir selecionados' }).click();
    await expect(page.locator('#notice')).toContainText('Digite REDEFINIR');
    await reset.getByRole('button', { name: 'Cancelar' }).click();
    await page.getByRole('button', { name: 'Operações e atividade', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Operações e atividade' })).toBeVisible();
    await expect(page.locator('#main')).toContainText('Pedidos agora');
    await expect(page.locator('#main')).toContainText('Modo de manutenção');
    await expect(page.locator('#main')).toContainText('Não existe botão de reiniciar');
    await page.screenshot({ path: `${artifacts}/admin-operations.png`, fullPage: true });
    await page.getByRole('button', { name: 'Equipe e permissões', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Equipe administrativa' })).toBeVisible();
    await page.getByRole('button', { name: 'Nova conta', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Detalhes' });
    await drawer.getByLabel('Pseudônimo', { exact: true }).fill('moderador-sintetico');
    await drawer.getByLabel('Senha inicial (12+ caracteres)', { exact: true }).fill(password);
    await drawer.getByRole('button', { name: 'Criar conta', exact: true }).click();
    await expect(page.locator('#main')).toContainText('moderador-sintetico');
    await page.getByRole('button', { name: 'Nova conta', exact: true }).click();
    await drawer.getByLabel('Pseudônimo', { exact: true }).fill('administrador-sintetico');
    await drawer.getByLabel('Senha inicial (12+ caracteres)', { exact: true }).fill(password);
    await drawer
        .getByRole('combobox', { name: 'Cargo', exact: true })
        .selectOption('administrator');
    await drawer.getByRole('button', { name: 'Criar conta', exact: true }).click();
    await expect(page.locator('#main')).toContainText('administrador-sintetico');
    await page.getByRole('button', { name: 'Limites da comunidade', exact: true }).click();
    await page.getByRole('spinbutton', { name: /^MB por arquivo/ }).fill('19');
    await page.getByRole('button', { name: 'Salvar limites', exact: true }).click();
    await page
        .locator('#confirmation')
        .getByRole('button', { name: 'Confirmar', exact: true })
        .click();
    await expect(page.locator('#notice')).toContainText('Limites atualizados');
    const reported = await page.request.post('/api/reports', {
        data: {
            target_type: 'post',
            target_id: '40000000-0000-4000-8000-000000000001',
            reason: 'spam',
            message: 'Pedido sintético de conferência'
        }
    });
    expect(reported.status()).toBe(201);
    await page.getByRole('button', { name: /^Moderação/ }).click();
    await page
        .getByRole('searchbox', { name: 'Buscar mensagem, motivo ou ID do conteúdo', exact: true })
        .fill('conferencia');
    await page.getByRole('button', { name: 'Buscar', exact: true }).first().click();
    await page
        .getByRole('checkbox', { name: /^Selecionar denúncia/ })
        .first()
        .check();
    await page.getByRole('button', { name: 'Recusar selecionados', exact: true }).first().click();
    await page
        .locator('#confirmation')
        .getByLabel('Motivo', { exact: true })
        .fill('Conteúdo sintético permitido após revisão');
    await page
        .locator('#confirmation')
        .getByRole('button', { name: 'Confirmar decisão', exact: true })
        .click();
    await expect(page.locator('#notice')).toContainText('Decisão registrada');
    await page.getByRole('button', { name: 'Recusadas', exact: true }).click();
    await page.getByText('Histórico de decisões', { exact: true }).click();
    await expect(page.locator('#main')).toContainText('Conteúdo sintético permitido após revisão');
    await page.getByRole('button', { name: 'Auditoria', exact: true }).click();
    await page.getByLabel('Ação', { exact: true }).fill('report.reject');
    await page.getByRole('button', { name: 'Filtrar', exact: true }).click();
    await expect(page.locator('#main')).toContainText('Conteúdo sintético permitido após revisão');
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await page.getByLabel('Pseudônimo', { exact: true }).fill('moderador-sintetico');
    await page.getByLabel('Senha', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.getByText('Configurar sem QR', { exact: true }).click();
    const moderatorSecret = (await page.locator('#qr-area code').textContent())!;
    await page.getByLabel('Código do autenticador ou recuperação').fill(totp(moderatorSecret));
    await page.getByRole('button', { name: 'Confirmar autenticador' }).click();
    await page.getByRole('button', { name: 'Guardei os códigos' }).click();
    await expect(
        page.getByRole('button', { name: 'Equipe e permissões', exact: true })
    ).toBeHidden();
    await expect(
        page.getByRole('button', { name: 'Sistema e armazenamento', exact: true })
    ).toBeHidden();
    expect((await page.request.get('/api/admin/api/accounts')).status()).toBe(403);
    await expect(page.locator('#main')).toContainText('Moderação');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `${artifacts}/admin-mobile.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
    );
    expect(failures).toEqual([]);
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await page.getByLabel('Pseudônimo', { exact: true }).fill('administrador-sintetico');
    await page.getByLabel('Senha', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.getByText('Configurar sem QR', { exact: true }).click();
    const administratorSecret = (await page.locator('#qr-area code').textContent())!;
    await page.getByLabel('Código do autenticador ou recuperação').fill(totp(administratorSecret));
    await page.getByRole('button', { name: 'Confirmar autenticador' }).click();
    await page.getByRole('button', { name: 'Guardei os códigos' }).click();
    await page.getByRole('button', { name: 'Equipe e permissões', exact: true }).click();
    await page.getByRole('button', { name: 'Nova conta', exact: true }).click();
    await expect(
        drawer.getByRole('combobox', { name: 'Cargo', exact: true }).locator('option')
    ).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Minha segurança', exact: true }).click();
    await expect(
        page.getByRole('heading', { name: 'Transferir a instalação', exact: true })
    ).toHaveCount(0);
    expect(
        (
            await page.request.post('/api/admin/api/maintenance', {
                headers: { 'X-Admin-Request': '1' }
            })
        ).status()
    ).toBe(403);
    expect(failures).toEqual([]);
});
