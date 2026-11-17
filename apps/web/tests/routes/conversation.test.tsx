import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
    createMemoryHistory,
    createRootRoute,
    createRouter,
    RouterContextProvider
} from '@tanstack/react-router';
import { afterEach, expect, spyOn, test } from 'bun:test';

import type { PostDetails } from '#/queries/community';

import { apiClient } from '#/queries/client';
import { meQueryOptions } from '#/queries/me';
import { Conversation } from '#/routes/_app/comunidade_.$id';

import { useDom } from '../helpers/dom';

const dom = useDom();
afterEach(() => dom.testing.cleanup());

const post = (id: string): PostDetails => ({
    id,
    kind: 'duvida',
    title: `Conversa ${id}`,
    body: 'Texto',
    excerpt: 'Texto',
    resolved: false,
    mine: false,
    campus: null,
    course: null,
    subject: null,
    reply_count: 0,
    replies: [],
    created_at: '2026-11-17T12:00:00Z',
    last_activity_at: '2026-11-17T12:00:00Z'
});

test('trocar conversa descarta rascunho anterior e envia só a resposta da conversa atual', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    client.setQueryData(meQueryOptions.queryKey, null);
    const router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() });
    const tree = (id: string) => (
        <QueryClientProvider client={client}>
            <RouterContextProvider router={router}>
                <Conversation post={post(id)} canEdit />
            </RouterContextProvider>
        </QueryClientProvider>
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- resposta parcial do endpoint de respostas
    const response = spyOn(apiClient, 'POST').mockResolvedValue({ data: post('b') } as never);
    try {
        const page = dom.testing.render(tree('a'));
        dom.testing.fireEvent.change(page.getByLabelText('Sua resposta'), {
            target: { value: 'Rascunho A' }
        });
        page.rerender(tree('b'));
        expect(page.getByLabelText('Sua resposta')).toHaveProperty('value', '');
        expect(page.getByRole('button', { name: 'Responder' }).hasAttribute('disabled')).toBe(true);
        dom.testing.fireEvent.change(page.getByLabelText('Sua resposta'), {
            target: { value: 'Resposta B' }
        });
        dom.testing.fireEvent.submit(
            page.getByRole('button', { name: 'Responder' }).closest('form')!
        );
        await dom.testing.waitFor(() => expect(response).toHaveBeenCalledTimes(1));
        expect(response.mock.calls[0]?.[1]).toMatchObject({
            params: { path: { post_id: 'b' } },
            body: { body: 'Resposta B' }
        });
    } finally {
        response.mockRestore();
        client.clear();
    }
});
