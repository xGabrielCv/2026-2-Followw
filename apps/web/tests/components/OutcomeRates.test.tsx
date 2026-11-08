import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
    createMemoryHistory,
    createRootRoute,
    createRouter,
    RouterProvider
} from '@tanstack/react-router';
import { afterEach, expect, test } from 'bun:test';

import type { ProfessorOutcomes, SubjectOutcomes } from '#/queries/outcomes';

import { ProfessorOutcomesSection, SubjectOutcomesSection } from '#/components/OutcomeRates';
import {
    nameKey,
    professorOutcomesQueryOptions,
    subjectOutcomesQueryOptions
} from '#/queries/outcomes';

import { useDom } from '../helpers/dom';

const dom = useDom();
afterEach(() => dom.testing.cleanup());

const rates = (failed: number, classrooms = 2) => ({
    classrooms,
    approved: 100 - failed - 5,
    failed,
    dropped: 5
});

const subject: SubjectOutcomes = {
    subject: rates(18, 6),
    professors: [
        { name: 'ANA SOUZA', siape: 123, subject: rates(30), overall: rates(25, 5) },
        { name: 'JOÃO LIMA', siape: null, subject: rates(5), overall: rates(5) },
        { name: 'NOVO DOCENTE', siape: null, subject: null, overall: null }
    ]
};

async function render(element: React.ReactNode, setup: (client: QueryClient) => void) {
    const client = new QueryClient();
    setup(client);
    const root = createRootRoute({ component: () => element });
    const router = createRouter({ routeTree: root, history: createMemoryHistory() });
    await router.load();
    return dom.testing.render(
        <QueryClientProvider client={client}>
            <RouterProvider router={router} />
        </QueryClientProvider>
    );
}

test('mostra a reprovação da matéria e destaca os docentes da turma', async () => {
    const page = await render(
        <SubjectOutcomesSection code="FGA0030" professors={['Ana Souza']} />,
        (client) => client.setQueryData(subjectOutcomesQueryOptions('FGA0030').queryKey, subject)
    );
    const section = await page.findByRole('region', { name: 'Índices de reprovação' });
    expect(section.textContent).toContain('18% reprovação');
    expect(section.textContent).toContain('em 6 turmas');
    // só a docente da turma, com o índice nesta matéria e o geral
    expect(section.textContent).toContain('Ana Souza');
    expect(section.textContent).toContain('Geral do docente: 25% reprovação em 5 turmas');
    expect(section.textContent).not.toContain('João Lima');
    expect(page.getByRole('link', { name: 'Ana Souza' }).getAttribute('href')).toBe(
        '/professores/123'
    );

    dom.testing.fireEvent.click(
        page.getByRole('button', { name: 'Comparar com os 3 docentes da matéria (2 com dados)' })
    );
    // do que menos reprova ao que mais reprova, os sem dados no fim
    const names = [...section.querySelectorAll('li > span:first-child')].map(
        (item) => item.textContent
    );
    expect(names).toEqual(['João Lima', 'Ana Souza', 'Novo Docente']);
});

test('sem dados da matéria, avisa', async () => {
    const page = await render(<SubjectOutcomesSection code="FGA0099" />, (client) =>
        client.setQueryData(subjectOutcomesQueryOptions('FGA0099').queryKey, {
            subject: null,
            professors: []
        })
    );
    expect(await page.findByText('Ainda não há dados desta matéria.')).toBeDefined();
});

test('no perfil, o índice geral do docente e o de cada matéria', async () => {
    const outcomes: ProfessorOutcomes = {
        overall: rates(20, 4),
        subjects: [
            { code: 'FGA0030', name: 'ESTRUTURAS DE DADOS 2', rates: rates(10) },
            { code: 'FGA0124', name: 'PROJETO DE ALGORITMOS', rates: rates(30) }
        ]
    };
    const page = await render(<ProfessorOutcomesSection siape={123} />, (client) =>
        client.setQueryData(professorOutcomesQueryOptions(123).queryKey, outcomes)
    );
    const section = await page.findByRole('region', { name: 'Índices de reprovação' });
    expect(section.textContent).toContain('Média em todas as matérias');
    expect(section.textContent).toContain('20% reprovação');
    // a que mais reprova primeiro
    expect(section.textContent?.indexOf('Projeto de Algoritmos')).toBeLessThan(
        section.textContent?.indexOf('Estruturas de Dados 2') ?? 0
    );
});

test('nameKey compara nomes sem acento, caixa ou espaço extra', () => {
    expect(nameKey('  João   LIMA ')).toBe(nameKey('joao lima'));
});
