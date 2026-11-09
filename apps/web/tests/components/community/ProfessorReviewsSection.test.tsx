import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
    createMemoryHistory,
    createRootRoute,
    createRouter,
    RouterProvider
} from '@tanstack/react-router';
import { afterEach, expect, test } from 'bun:test';

import type { components } from '#/queries/schema.gen';

import {
    ProfessorReviewsSection,
    ReviewList
} from '#/components/community/ProfessorReviewsSection';
import { meQueryOptions } from '#/queries/me';
import { professorReviewsQueryOptions } from '#/queries/reviews';

import { useDom } from '../../helpers/dom';

const dom = useDom();
afterEach(() => dom.testing.cleanup());

type Reviews = components['schemas']['ProfessorReviews'];

async function render(reviews: Reviews) {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    client.setQueryData(meQueryOptions.queryKey, null);
    client.setQueryData(professorReviewsQueryOptions(111).queryKey, reviews);
    const root = createRootRoute({
        component: () => <ProfessorReviewsSection siape={111} name="TIAGO ALVES FONSECA" />
    });
    const router = createRouter({ routeTree: root, history: createMemoryHistory() });
    await router.load();
    return dom.testing.render(
        <QueryClientProvider client={client}>
            <RouterProvider router={router} />
        </QueryClientProvider>
    );
}

const review = (id: string, rating: number, comment: string | null) => ({
    id,
    rating,
    semester: null,
    criteria: null,
    comment,
    attendance: 'cobra' as const,
    subject: { code: 'FGA0211', name: 'FUNDAMENTOS DE REDES' },
    month: '2026-11'
});

test('mostra a nota média e a chamada; os textos ficam no pop-up', async () => {
    const page = await render({
        total: 3,
        page: 1,
        page_size: 20,
        summary: { count: 3, average: 81.7, attendance: { cobra: 2, nao_cobra: 0, varia: 1 } },
        reviews: [
            review('a', 90, 'Explica muito bem.'),
            review('b', 75, null),
            review('c', 80, 'Provas justas.')
        ]
    });
    const section = await page.findByRole('region', { name: 'Avaliações dos alunos' });
    expect(section.textContent).toContain('82');
    expect(section.textContent).toContain('3 avaliações anônimas');
    expect(section.textContent).toContain('Cobra chamada');
    expect(section.textContent).toContain('Cobra 67%');
    expect(section.textContent).toContain('Varia 33%');
    // o texto das avaliações não fica na página, só no pop-up
    expect(section.textContent).not.toContain('Explica muito bem.');
    expect(page.getByRole('button', { name: 'Ver avaliações completas' })).toBeDefined();
    // sem login, convida a entrar em vez de avaliar
    expect(page.getByRole('link', { name: 'Entre para avaliar' })).toBeDefined();
});

test('o pop-up lista as avaliações com nota, matéria e chamada, mantendo a ordem selecionada', () => {
    const page = dom.testing.render(
        <ReviewList
            reviews={[
                review('b', 75, null),
                review('a', 90, 'Explica muito bem.'),
                review('c', 80, 'Provas justas.')
            ]}
        />
    );
    const items = page.getAllByRole('listitem');
    expect(items.map((item) => item.textContent?.includes('Sem comentário.'))).toEqual([
        true,
        false,
        false
    ]);
    expect(items[0]?.textContent).toContain('Nota 75');
    expect(items[0]?.textContent).toContain('FGA0211');
    expect(items[0]?.textContent).toContain('Chamada: Cobra');
});

test('sem avaliações, explica que ainda não há nenhuma', async () => {
    const page = await render({ summary: null, reviews: [], total: 0, page: 1, page_size: 20 });
    expect(await page.findByText(/Ninguém avaliou este docente ainda/)).toBeDefined();
});
