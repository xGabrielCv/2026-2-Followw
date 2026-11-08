import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, spyOn, test } from 'bun:test';

import type { ClassroomGroups } from '#/queries/groups';

import { GroupsContent } from '#/components/community/GroupsDialog';
import { apiClient } from '#/queries/client';
import { classroomGroupsQueryOptions } from '#/queries/groups';
import { meQueryOptions } from '#/queries/me';

import { useDom } from '../../helpers/dom';

const dom = useDom();
afterEach(() => dom.testing.cleanup());

const key = { code: 'FGA0030', semester: '2026.2', number: '01' };
const classroom = { ...key, name: 'ESTRUTURAS DE DADOS 2' };

function render(groups: ClassroomGroups['groups'], loggedIn = true) {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    client.setQueryData(classroomGroupsQueryOptions(key).queryKey, { classroom, groups });
    client.setQueryData<{ registration: string } | null>(
        meQueryOptions.queryKey,
        loggedIn ? { registration: '202600001' } : null
    );
    return dom.testing.render(
        <QueryClientProvider client={client}>
            <GroupsContent classroom={key} />
        </QueryClientProvider>
    );
}

test('mostra os grupos cadastrados com link e a senha do aprender 3', async () => {
    const page = render([
        { id: 'g1', platform: 'whatsapp', url: 'https://chat.whatsapp.com/AbC', password: null },
        {
            id: 'g2',
            platform: 'aprender3',
            url: 'https://aprender3.unb.br/course/1',
            password: 'chave123'
        }
    ]);

    const list = await page.findByRole('list', { name: 'Grupos cadastrados' });
    expect(list.textContent).toContain('WhatsApp');
    expect(list.textContent).toContain('Aprender 3');
    expect(list.textContent).toContain('chave123');
    const link = page.getByRole('link', { name: 'Entrar no grupo do WhatsApp' });
    expect(link.getAttribute('href')).toBe('https://chat.whatsapp.com/AbC');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(page.getByText(/nunca quem cadastrou/)).toBeDefined();
    expect(page.getByRole('button', { name: 'Editar grupos' })).toBeDefined();
});

test('sem grupos, inicia o cadastro e salva só a turma e os links', async () => {
    const fake = {
        data: {
            classroom,
            groups: [{ platform: 'telegram', url: 'https://t.me/+ed2', password: null }]
        },
        error: undefined,
        response: new Response()
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- resposta parcial da API
    const put = spyOn(apiClient, 'PUT').mockResolvedValue(fake as never);
    try {
        const page = render([]);
        dom.testing.fireEvent.click(await page.findByRole('button', { name: 'Cadastrar grupo' }));

        const save = page.getByRole('button', { name: 'Salvar grupos' });
        const url = page.getByLabelText('Link');
        dom.testing.fireEvent.change(url, { target: { value: 'https://t.me/+ed2' } });
        // o link do Telegram não vale como WhatsApp
        expect(save.hasAttribute('disabled')).toBe(true);
        expect(page.getByText('Use o link https do WhatsApp.')).toBeDefined();

        dom.testing.fireEvent.change(url, {
            target: { value: 'https://chat.whatsapp.com/Ed2' }
        });
        expect(save.hasAttribute('disabled')).toBe(false);
        dom.testing.fireEvent.click(page.getByRole('button', { name: 'Adicionar grupo' }));
        dom.testing.fireEvent.click(page.getByRole('button', { name: 'Adicionar grupo' }));
        // três é o limite
        expect(page.queryByRole('button', { name: 'Adicionar grupo' })).toBeNull();
        dom.testing.fireEvent.click(page.getByRole('button', { name: 'Remover grupo 3' }));
        dom.testing.fireEvent.click(page.getByRole('button', { name: 'Remover grupo 2' }));

        dom.testing.fireEvent.submit(save.closest('form')!);
        await dom.testing.waitFor(() => expect(put).toHaveBeenCalled());
        expect(put.mock.calls[0] as unknown).toEqual([
            '/groups/{code}/{semester}/{number}',
            {
                params: { path: key },
                body: {
                    groups: [
                        {
                            platform: 'whatsapp',
                            url: 'https://chat.whatsapp.com/Ed2',
                            password: null
                        }
                    ]
                }
            }
        ]);
        expect(await page.findByRole('list', { name: 'Grupos cadastrados' })).toBeDefined();
    } finally {
        put.mockRestore();
    }
});

test('visitante abre grupos sem controles de cadastro ou edição', async () => {
    const page = render(
        [{ id: 'g1', platform: 'whatsapp', url: 'https://chat.whatsapp.com/AbC', password: null }],
        false
    );
    expect(await page.findByRole('link', { name: 'Entrar no grupo do WhatsApp' })).toBeDefined();
    expect(page.queryByRole('button', { name: 'Editar grupos' })).toBeNull();
    expect(page.queryByRole('button', { name: 'Cadastrar grupo' })).toBeNull();
});
