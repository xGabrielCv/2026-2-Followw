import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, spyOn, test } from 'bun:test';

import { ReportForm } from '#/components/community/ReportButton';
import { apiClient } from '#/queries/client';

import { useDom } from '../../helpers/dom';

const dom = useDom();
afterEach(() => dom.testing.cleanup());

test('pede a exclusão com o motivo e a mensagem, sem dado de quem pediu', async () => {
    const fake = { data: { id: 'r1' }, error: undefined, response: new Response() };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- resposta parcial da API
    const post = spyOn(apiClient, 'POST').mockResolvedValue(fake as never);
    try {
        const page = dom.testing.render(
            <QueryClientProvider client={new QueryClient()}>
                <ReportForm target="review" id="abc" onDone={() => {}} />
            </QueryClientProvider>
        );
        dom.testing.fireEvent.click(page.getByRole('button', { name: 'Expõe alguém' }));
        dom.testing.fireEvent.change(page.getByLabelText('Explique (opcional)'), {
            target: { value: '  Sou o docente.  ' }
        });
        dom.testing.fireEvent.submit(
            page.getByRole('button', { name: 'Enviar pedido' }).closest('form')!
        );
        expect(await page.findByText(/Pedido enviado/)).toBeDefined();
        expect(post.mock.calls[0] as unknown).toEqual([
            '/reports',
            {
                body: {
                    target_type: 'review',
                    target_id: 'abc',
                    reason: 'dados_pessoais',
                    message: 'Sou o docente.'
                }
            }
        ]);
    } finally {
        post.mockRestore();
    }
});
