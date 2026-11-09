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

test('aluno abre chamado sem login, o atendimento responde e o aluno vê a resposta', async ({
    browser
}) => {
    const failures: string[] = [];
    const student = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const staff = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const phone = await student.newPage();
    const desk = await staff.newPage();
    for (const page of [phone, desk]) page.on('pageerror', (error) => failures.push(error.message));

    // ---- aluno: Mais → Suporte e ajuda → novo chamado
    await phone.goto('/mais');
    await phone.getByRole('link', { name: /Suporte e ajuda/ }).click();
    await expect(phone.getByRole('button', { name: 'Novo chamado' })).toBeVisible();
    await expect(phone.getByText('Nenhum chamado neste aparelho')).toBeVisible();
    const form = phone.getByRole('dialog', { name: 'Novo chamado' });
    // o clique pode chegar antes da hidratação: repete até o diálogo abrir
    await expect(async () => {
        await phone.getByRole('button', { name: 'Novo chamado' }).click();
        await expect(form).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 15_000 });
    await form.getByLabel('Título').fill('Agenda do dia não abre');
    await form.getByLabel('Mensagem').fill('Minha matrícula é 190012345 e a agenda trava.');
    await expect(form.getByRole('alert')).toContainText('CPF, e-mail ou matrícula');
    await expect(form.getByRole('button', { name: 'Enviar' })).toBeDisabled();
    await form.getByLabel('Mensagem').fill('A agenda do dia fica em branco ao abrir o app.');
    await form.getByRole('button', { name: 'Enviar' }).click();
    const code = phone.getByRole('dialog', { name: /Chamado #\d+ aberto/ });
    await expect(code).toContainText(/[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}/);
    const recovery = (await code.locator('p.font-mono').textContent())!.trim();
    await code.getByRole('button', { name: 'Já guardei' }).click();
    await expect(phone.getByRole('heading', { name: 'Agenda do dia não abre' })).toBeVisible();
    await expect(phone.getByText('Aberto', { exact: true }).first()).toBeVisible();
    const ticketId = phone.url().split('/suporte/')[1];
    await phone.screenshot({ path: `${artifacts}/support-mobile-thread.png`, fullPage: true });
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
    );

    // ---- atendimento: Owner (MFA) responde pelo painel
    await desk.goto('/api/admin');
    await desk.getByLabel('Pseudônimo', { exact: true }).fill('owner-sintetico');
    await desk.getByLabel('Senha', { exact: true }).fill(password);
    await desk.getByLabel('Repita a senha').fill(password);
    await desk.getByRole('button', { name: 'Cadastrar e configurar MFA' }).click();
    await desk.getByText('Configurar sem QR', { exact: true }).click();
    const secret = (await desk.locator('#qr-area code').textContent())!;
    await desk.getByLabel('Código do autenticador ou recuperação').fill(totp(secret));
    await desk.getByRole('button', { name: 'Confirmar autenticador' }).click();
    await desk.getByRole('button', { name: 'Guardei os códigos' }).click();
    await desk.getByRole('button', { name: 'Chamados de suporte', exact: true }).click();
    await expect(desk.getByRole('heading', { name: 'Chamados de suporte' })).toBeVisible();
    await desk.getByRole('row', { name: /Agenda do dia não abre/ }).click();
    const drawer = desk.getByRole('dialog', { name: 'Detalhes' });
    await expect(drawer).toContainText('A agenda do dia fica em branco');
    await drawer.getByLabel('Mensagem').fill('Obrigado! Corrigimos na versão de hoje.');
    await drawer.getByRole('button', { name: 'Responder ao aluno' }).click();
    await expect(desk.locator('#notice')).toContainText('Resposta enviada');
    await desk.screenshot({ path: `${artifacts}/support-admin-queue.png`, fullPage: true });

    // ---- aluno vê a resposta
    await phone.reload();
    await expect(phone.getByText('Corrigimos na versão de hoje.')).toBeVisible();
    await expect(phone.getByText('Respondido', { exact: true }).first()).toBeVisible();

    // ---- outro navegador: sem a chave, só o código de recuperação abre o chamado
    const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const stranger = await other.newPage();
    await stranger.goto(`/suporte/${ticketId}`);
    await expect(stranger.getByText('não tem a chave deste chamado')).toBeVisible();
    await stranger.goto('/suporte');
    const recover = stranger.getByRole('dialog', { name: 'Recuperar chamado' });
    await expect(async () => {
        await stranger.getByRole('button', { name: 'Recuperar' }).click();
        await expect(recover).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 15_000 });
    await recover.getByLabel('Identificador').fill(ticketId);
    await recover.getByLabel('Código de recuperação').fill('0000-0000-0000-0000');
    await recover.getByRole('button', { name: 'Recuperar' }).click();
    await expect(recover.getByRole('alert')).toContainText('inválido');
    await recover.getByLabel('Código de recuperação').fill(recovery);
    await recover.getByRole('button', { name: 'Recuperar' }).click();
    await expect(stranger.getByText('Corrigimos na versão de hoje.')).toBeVisible();

    // ---- a chave antiga do primeiro aparelho deixou de valer
    await phone.reload();
    await expect(phone.getByText('Não foi possível abrir este chamado')).toBeVisible();

    const headers = { 'X-Admin-Request': '1' };
    const target = '40000000-0000-4000-8000-000000000001';
    const report = await desk.request.post('/api/reports', {
        data: {
            target_type: 'post',
            target_id: target,
            reason: 'outro',
            message: 'Conferência sintética da decisão'
        }
    });
    expect(report.status()).toBe(201);
    const reportId = (await report.json()).id;
    expect(
        (
            await desk.request.post(`/api/admin/api/reports/${reportId}`, {
                headers,
                data: { action: 'reject', reason: 'Conteúdo permitido nesta conferência sintética' }
            })
        ).status()
    ).toBe(204);
    await phone.goto(`/suporte?category=moderation_review&reference=post:${target}`);
    const appealForm = phone.getByRole('dialog', { name: 'Novo chamado' });
    await expect(appealForm).toBeVisible();
    await appealForm.getByLabel('Título', { exact: true }).fill('Recurso da decisão de moderação');
    await appealForm
        .getByLabel('Mensagem', { exact: true })
        .fill('Peço uma segunda análise do contexto desta decisão.');
    await appealForm.getByRole('button', { name: 'Enviar', exact: true }).click();
    await phone
        .getByRole('dialog', { name: /Chamado #\d+ aberto/ })
        .getByRole('button', { name: 'Já guardei' })
        .click();
    await expect(phone.getByText('Recurso aguardando decisão')).toBeVisible();
    const appealId = phone.url().split('/suporte/')[1];
    const decision = {
        body: 'Após segunda análise, acolhemos o pedido de revisão. As medidas cabíveis serão informadas neste chamado.',
        status: 'resolved',
        appeal_outcome: 'accepted'
    };
    expect(
        (
            await desk.request.post(`/api/admin/api/tickets/${appealId}/reply`, {
                headers,
                data: decision
            })
        ).status()
    ).toBe(409);
    expect(
        (
            await desk.request.post('/api/admin/api/accounts', {
                headers,
                data: { username: 'revisor-sintetico', password, role: 'moderator' }
            })
        ).status()
    ).toBe(201);
    const reviewer = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const review = await reviewer.newPage();
    await review.goto('/api/admin');
    await review.getByLabel('Pseudônimo', { exact: true }).fill('revisor-sintetico');
    await review.getByLabel('Senha', { exact: true }).fill(password);
    await review.getByRole('button', { name: 'Continuar', exact: true }).click();
    await review.getByText('Configurar sem QR', { exact: true }).click();
    const reviewerSecret = (await review.locator('#qr-area code').textContent())!;
    await review.getByLabel('Código do autenticador ou recuperação').fill(totp(reviewerSecret));
    await review.getByRole('button', { name: 'Confirmar autenticador' }).click();
    await review.getByRole('button', { name: 'Guardei os códigos' }).click();
    await review.getByRole('button', { name: 'Chamados de suporte', exact: true }).click();
    await review.getByRole('row', { name: /Recurso da decisão de moderação/ }).click();
    const appealDrawer = review.getByRole('dialog', { name: 'Detalhes' });
    await expect(appealDrawer).toContainText('Autoria não comprovada');
    await appealDrawer.getByLabel('Mensagem', { exact: true }).fill(decision.body);
    await appealDrawer.getByLabel('Decisão do recurso').selectOption('accepted');
    await appealDrawer.getByLabel('Estado depois da resposta').selectOption('resolved');
    await appealDrawer.getByRole('button', { name: 'Responder ao aluno' }).click();
    await expect(review.locator('#notice')).toContainText('Resposta enviada');
    await phone.reload();
    await expect(phone.getByText('Recurso aceito', { exact: true })).toBeVisible();
    await expect(phone.getByText(decision.body, { exact: true })).toBeVisible();
    await stranger.goto(`/suporte/${appealId}`);
    await expect(stranger.getByText('não tem a chave deste chamado')).toBeVisible();
    await reviewer.close();

    expect(failures).toEqual([]);
});
