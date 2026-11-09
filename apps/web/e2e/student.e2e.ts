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
