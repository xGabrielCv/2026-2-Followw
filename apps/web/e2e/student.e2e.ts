import { expect, test } from '@playwright/test';

import { login, ready } from './helpers/student';

test('aluno publica sem cookie acadêmico, edita perfil offline e troca de conta entre abas', async ({
    page,
    context
}) => {
    await login(page);
    const community: { method: string; cookie: boolean; author: boolean; permission: boolean }[] =
        [];
    const issuance: { cookie: boolean; author: boolean }[] = [];
    page.on('request', async (request) => {
        const path = new URL(request.url()).pathname;
        if (!path.startsWith('/api/forum') && path !== '/api/auth/community-permits') return;
        const headers = await request.allHeaders();
        if (path === '/api/auth/community-permits')
            issuance.push({
                cookie: Boolean(headers.cookie),
                author: Boolean(headers['x-followw-author'])
            });
        else
            community.push({
                method: request.method(),
                cookie: Boolean(headers.cookie),
                author: Boolean(headers['x-followw-author']),
                permission: Boolean(headers['x-followw-permit'])
            });
    });
    await page.goto('/comunidade');
    await ready(page);
    await page.getByRole('button', { name: 'Publicar', exact: true }).click();
    const form = page.getByRole('dialog', { name: 'Nova publicação' });
    await form
        .getByLabel('Título', { exact: true })
        .fill('Pergunta sintética para validar a comunidade');
    await form
        .getByLabel('Texto', { exact: true })
        .fill('Texto sintético sem identificação acadêmica.');
    await form.getByRole('button', { name: 'Publicar', exact: true }).click();
    await expect(form).not.toBeVisible();
    await expect(
        page.getByText('Pergunta sintética para validar a comunidade', { exact: true })
    ).toBeVisible();
    expect(issuance).toContainEqual({ cookie: true, author: false });
    expect(community.length).toBeGreaterThan(0);
    expect(community.every((item) => !item.cookie)).toBe(true);
    expect(community.some((item) => item.method === 'POST' && item.author && item.permission)).toBe(
        true
    );

    await page.getByRole('button', { name: 'Marcar como resolvida', exact: true }).click();
    await expect(page.getByText('Dúvida resolvida', { exact: true })).toBeVisible();
    expect(
        community.some(
            (item) => item.method === 'PATCH' && item.author && item.permission && !item.cookie
        )
    ).toBe(true);
    await page.goto('/perfil');
    await ready(page);
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Editar perfil' }).click();
    await page.getByLabel('Nome de exibição', { exact: true }).fill('Nome local da conta A');
    await page.getByLabel('Bio', { exact: true }).fill('Bio privada local de teste');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByRole('dialog', { name: 'Editar perfil' })).not.toBeVisible();
    await expect(page.getByText('Nome local da conta A', { exact: true }).first()).toBeVisible();
    await context.setOffline(false);
    await page.reload();
    await ready(page);
    await expect(page.getByText('Nome local da conta A', { exact: true }).first()).toBeVisible();

    // Uma nova autenticação noutra aba precisa invalidar a memória da aba antiga.
    await page.getByRole('button', { name: 'Desconectar', exact: true }).click();
    await page
        .getByRole('alertdialog', { name: 'Desconectar?' })
        .getByRole('button', { name: 'Sair', exact: true })
        .click();
    await expect(page.getByRole('button', { name: 'Editar perfil' })).not.toBeVisible();
    const other = await context.newPage();
    await login(other, '252000000');
    await expect(
        other.getByRole('heading', { name: 'Aluno Simulado B', exact: true })
    ).toBeVisible();
    await expect(other.getByText('Nome local da conta A', { exact: true })).toHaveCount(0);
    await page.bringToFront();
    await expect(
        page.getByRole('heading', { name: 'Aluno Simulado B', exact: true })
    ).toBeVisible();
    await expect(page.getByText('Bio privada local de teste', { exact: true })).toHaveCount(0);
    const values = await page.evaluate(() => Object.values(localStorage));
    expect(values.every((value) => !value.includes('Bio privada local de teste'))).toBe(true);
});

test('buscar posiciona seletor no cabeçalho e modal de alerta respeita limites em celular e desktop', async ({
    page
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/buscar');
    await ready(page);
    const select = page.getByLabel('Semestre da oferta', { exact: true });
    await expect(select).toBeVisible();
    const mobileBuscar = await page.evaluate(() => {
        const header = document.querySelector('header');
        const sel = document.querySelector('select[aria-label="Semestre da oferta"]');
        return {
            scrollW: document.documentElement.scrollWidth,
            clientW: document.documentElement.clientWidth,
            inHeader: Boolean(header && sel && header.contains(sel))
        };
    });
    expect(mobileBuscar.inHeader).toBe(true);
    expect(mobileBuscar.scrollW).toBeLessThanOrEqual(mobileBuscar.clientW);

    await page.route('**/api/public/config', async (route) => {
        const response = await route.fetch();
        const json = await response.json();
        json.alert = { ...json.alert, enabled: true, always_on: true };
        await route.fulfill({ response, json });
    });

    await page.goto('/login');
    await ready(page);
    await page.getByRole('textbox', { name: 'Matrícula', exact: true }).fill('251000000');
    await page.getByLabel('Senha do SIGAA', { exact: true }).fill('simulada123');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL(/\/perfil$/);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });
    const assertDialogFits = async (width: number) => {
        await page.setViewportSize({ width, height: 844 });
        const bounds = await dialog.evaluate((el) => {
            const box = el.getBoundingClientRect();
            const children = Array.from(el.querySelectorAll('button, li, p'));
            const maxChildRight = Math.max(
                box.right,
                ...children.map((node) => node.getBoundingClientRect().right)
            );
            return {
                dialogRight: box.right,
                dialogLeft: box.left,
                maxChildRight,
                viewportWidth: window.innerWidth,
                scrollW: el.scrollWidth,
                clientW: el.clientWidth
            };
        });
        expect(bounds.dialogLeft).toBeGreaterThanOrEqual(0);
        expect(bounds.dialogRight).toBeLessThanOrEqual(bounds.viewportWidth);
        expect(bounds.maxChildRight).toBeLessThanOrEqual(bounds.dialogRight + 1);
        expect(bounds.scrollW).toBeLessThanOrEqual(bounds.clientW + 1);
    };
    await assertDialogFits(390);
    await assertDialogFits(1280);
});

test('atualiza aproveitamentos na própria conta e baixa um arquivo da turma', async ({ page }) => {
    await login(page);
    let imported = 0;
    await page.route('**/api/me/transcript/completed-subjects', async (route) => {
        expect(route.request().method()).toBe('POST');
        imported += 1;
        await route.fulfill({ json: ['MAT0025'] });
    });
    await page.goto('/cursos/1');
    await ready(page);
    const sync = page.getByRole('button', { name: 'Atualizar aproveitamentos' });
    await expect(sync).toBeEnabled();
    expect(imported).toBe(0);
    await sync.click();
    await expect(page.getByText('1 componente localizado.')).toBeVisible();
    expect(imported).toBe(1);
    await expect(page.getByRole('button', { name: /MAT0025,.*Concluída/i })).toBeVisible();
    await page.reload();
    await ready(page);
    await expect(page.getByRole('button', { name: /MAT0025,.*Concluída/i })).toBeVisible();
    expect(imported).toBe(1);

    const postId = `material:${'a'.repeat(64)}`;
    await page.route('**/api/classrooms/*/posts', async (route) => {
        await route.fulfill({
            json: [
                {
                    id: postId,
                    type: 'material',
                    material_kind: 'file',
                    title: 'Aula de teste',
                    attachments: []
                }
            ]
        });
    });
    await page.route('**/api/classrooms/*/posts/*/download', async (route) => {
        expect(route.request().method()).toBe('POST');
        expect(decodeURIComponent(new URL(route.request().url()).pathname)).toContain(postId);
        await route.fulfill({
            body: 'Arquivo sintético',
            headers: {
                'content-type': 'application/octet-stream',
                'content-disposition': "attachment; filename*=UTF-8''Aula%20%C3%A7.txt"
            }
        });
    });
    await page.goto('/turmas');
    await ready(page);
    await page.getByRole('button', { name: 'ESTRUTURAS DE DADOS 1', exact: true }).click();
    await page.getByRole('tab', { name: 'Postagens', exact: true }).click();
    await page.getByRole('button', { name: /Aula de teste/ }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Baixar', exact: true }).click();
    expect((await download).suggestedFilename()).toBe('Aula ç.txt');
});
