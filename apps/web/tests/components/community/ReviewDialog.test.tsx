import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, spyOn, test } from 'bun:test';

import { ReviewPanel } from '#/components/community/ReviewDialog';
import { apiClient } from '#/queries/client';
import { ownReviews } from '#/queries/reviews';

import { useDom } from '../../helpers/dom';

const dom = useDom();
afterEach(() => {
    dom.testing.cleanup();
    ownReviews.clear();
});

const tiago = { siape: 111, name: 'TIAGO ALVES FONSECA' };

function render(onDone = () => {}) {
    return dom.testing.render(
        <QueryClientProvider client={new QueryClient()}>
            <ReviewPanel professors={[tiago]} subject="FGA0211" onDone={onDone} />
        </QueryClientProvider>
    );
}

const created = {
    data: {
        review: {
            id: 'r1',
            rating: 85,
            comment: 'Boa didática.',
            attendance: 'cobra',
            subject: null,
            month: '2026-11'
        },
        token: 'segredo-do-navegador-123456'
    },
    error: undefined,
    response: new Response()
};

test('avisa do anonimato e de que o texto pode identificar', () => {
    const page = render();
    expect(page.getByText('Avaliação sem identificação de autoria.')).toBeDefined();
    expect(page.container.textContent).toContain('nome e matrícula não são associados');
    expect(page.container.textContent).toContain('o que você escreve pode te identificar');
    expect(page.getByLabelText(/Nota de Tiago Alves Fonseca/)).toBeDefined();
});

test('envia só a nota, a chamada, o comentário e a matéria, e guarda o segredo para editar', async () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- resposta parcial da API
    const post = spyOn(apiClient, 'POST').mockResolvedValue(created as never);
    const done: string[] = [];
    try {
        const page = render(() => done.push('fechou'));
        dom.testing.fireEvent.change(page.getByLabelText(/Nota de/), { target: { value: '85' } });
        dom.testing.fireEvent.click(page.getByRole('button', { name: 'Cobra' }));
        dom.testing.fireEvent.change(page.getByLabelText('Comentário (opcional)'), {
            target: { value: '  Boa didática.  ' }
        });
        dom.testing.fireEvent.submit(
            page.getByRole('button', { name: 'Enviar avaliação' }).closest('form')!
        );

        await dom.testing.waitFor(() => expect(done).toEqual(['fechou']));
        expect(post.mock.calls[0] as unknown).toEqual([
            '/reviews',
            {
                body: {
                    siape: 111,
                    rating: 85,
                    semester: null,
                    criteria: null,
                    attendance: 'cobra',
                    comment: 'Boa didática.',
                    subject: 'FGA0211'
                }
            }
        ]);
        expect(ownReviews.getSnapshot()[111]).toMatchObject({
            id: 'r1',
            token: 'segredo-do-navegador-123456',
            rating: 85
        });
    } finally {
        post.mockRestore();
    }
});

test('quem já avaliou neste aparelho atualiza a mesma avaliação pelo segredo', async () => {
    ownReviews.set({
        111: {
            id: 'r1',
            token: 'segredo-do-navegador-123456',
            rating: 40,
            attendance: 'varia',
            comment: null,
            subject: 'FGA0211'
        }
    });
    const fake = {
        data: created.data.review,
        error: undefined,
        response: new Response()
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- resposta parcial da API
    const put = spyOn(apiClient, 'PUT').mockResolvedValue(fake as never);
    try {
        const page = render();
        expect(page.container.textContent).toContain('Você já avaliou');
        expect(page.getByRole('button', { name: 'Apagar avaliação' })).toBeDefined();
        expect(page.getByText('40')).toBeDefined();

        dom.testing.fireEvent.submit(
            page.getByRole('button', { name: 'Atualizar avaliação' }).closest('form')!
        );
        await dom.testing.waitFor(() => expect(put).toHaveBeenCalled());
        expect(put.mock.calls[0]?.[1]).toMatchObject({
            params: {
                path: { review_id: 'r1' },
                header: { 'X-Review-Token': 'segredo-do-navegador-123456' }
            },
            body: { rating: 40, attendance: 'varia', comment: null, subject: 'FGA0211' }
        });
    } finally {
        put.mockRestore();
    }
});
