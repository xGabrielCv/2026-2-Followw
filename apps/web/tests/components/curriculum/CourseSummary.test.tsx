import type { Middleware } from 'openapi-fetch';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, test } from 'bun:test';

import type { CourseSummaryProps } from '#/components/curriculum/CourseSummary';
import type { PublicCourse } from '#/queries/courses';
import type { CourseCurriculum } from '#/queries/curriculum';

import { CourseSummary } from '#/components/curriculum/CourseSummary';
import { apiClient } from '#/queries/client';
import { courseQueryOptions } from '#/queries/courses';
import { curriculumQueryOptions } from '#/queries/curriculum';
import { type CourseIndicatorsDetail, courseIndicatorsQueryOptions } from '#/queries/indicators';

import { useDom } from '../../helpers/dom';

const dom = useDom();
const course: PublicCourse = {
    id: 42,
    sigaa_id: 100,
    name: 'ENGENHARIA DE SOFTWARE',
    shift: 'DIURNO',
    unit: { id: 1, code: 'FCTE', name: 'FACULDADE DE CIÊNCIAS E TECNOLOGIAS EM ENGENHARIA' },
    level: 'Graduação'
};
const matrix: CourseCurriculum = {
    sigaa_id: 2,
    code: '0123',
    course_id: 42,
    entry_semester: '2026.2',
    valid_from: '2024.1',
    matrix: 'ENGENHARIA DE SOFTWARE/FCTE - Bacharelado - Presencial - D',
    shift: 'D',
    degree: 'Bacharelado',
    modality: 'Presencial',
    periods: [
        { period: 1, subjects: [{ code: 'A', name: 'Base', hours: 60 }] },
        { period: 2, subjects: [{ code: 'B', name: 'Prática', hours: 30 }] }
    ],
    complementary: []
};
const emptyIndicators = (courseId: number): CourseIndicatorsDetail => ({
    course_id: courseId,
    pas_latest: null,
    pas_average: null,
    pas_cycle: null,
    pas_history: [],
    latest_metrics: null,
    historical_metrics: [],
    tamburetei_slug: null,
    updated_at: null
});
let client: QueryClient;
let middleware: Middleware;
let requests: string[];
beforeEach(() => {
    client = new QueryClient({
        defaultOptions: { queries: { staleTime: Infinity, retry: false } }
    });
    client.setQueryData(courseQueryOptions(course.id).queryKey, course);
    client.setQueryData(curriculumQueryOptions(course.id, '2026.2').queryKey, matrix);
    client.setQueryData(
        courseIndicatorsQueryOptions(course.id, matrix.degree, matrix.modality).queryKey,
        emptyIndicators(course.id)
    );
    client.setQueryData(
        courseIndicatorsQueryOptions(course.id, null, null).queryKey,
        emptyIndicators(course.id)
    );
    requests = [];
    middleware = {
        onRequest: ({ request }) => {
            requests.push(new URL(request.url).pathname);
            return Response.json({ detail: 'Indisponível' }, { status: 503 });
        }
    };
    apiClient.use(middleware);
});
afterEach(() => {
    dom.testing.cleanup();
    client.clear();
    apiClient.eject(middleware);
});
function renderSummary(props: CourseSummaryProps = { course, entrySemester: '2026.2' }) {
    return dom.testing.render(
        <QueryClientProvider client={client}>
            <CourseSummary {...props} />
        </QueryClientProvider>
    );
}

test('resume unidade, turno, grau e matriz do curso com os dados já salvos', () => {
    const page = renderSummary();
    expect(page.getByRole('heading', { name: 'ENGENHARIA DE SOFTWARE' })).toBeDefined();
    expect(page.getByText('FCTE').parentElement?.textContent).toBe('FCTE · Matriz 0123 - 2024.1');
    expect(page.getByText('Diurno · Presencial')).toBeDefined();
    expect(page.getByText('Bacharelado')).toBeDefined();
    expect(page.getByText('Faculdade de Ciências e Tecnologias em Engenharia')).toBeDefined();
    expect(page.getByText('2 semestres · 2 matérias obrigatórias')).toBeDefined();
    expect(page.queryByText(matrix.matrix)).toBeNull();
    expect(requests).toEqual([]);
});

test('consulta a matriz do curso exibido sem reaproveitar a de outro curso', async () => {
    const other = { ...course, id: 99, name: 'ADMINISTRAÇÃO', shift: 'NOTURNO' };
    client.setQueryData(courseQueryOptions(other.id).queryKey, other);
    client.setQueryData(
        courseIndicatorsQueryOptions(other.id, null, null).queryKey,
        emptyIndicators(other.id)
    );
    const page = renderSummary({ course: other, entrySemester: '2026.2' });
    await dom.testing.waitFor(() =>
        expect(requests).toEqual(['/api/public/courses/99/curriculum'])
    );
    expect(page.getByText('Noturno')).toBeDefined();
    expect(page.queryByText('Bacharelado')).toBeNull();
});

test('sem semestre nem catálogo exibe apenas o que está disponível', async () => {
    client.removeQueries({ queryKey: courseQueryOptions(course.id).queryKey });
    const page = renderSummary({ course: { ...course, shift: null } });
    expect(page.getByText('Turno não informado')).toBeDefined();
    expect(page.getByText('Unidade não informada')).toBeDefined();
    expect(page.queryByText(/semestres/)).toBeNull();
    await dom.testing.waitFor(() => expect(requests).toEqual(['/api/public/courses/42']));
});

test('turno da matriz cobre o curso sem turno no catálogo', () => {
    const page = renderSummary({ course: { ...course, shift: null }, entrySemester: '2026.2' });
    expect(page.getByText('Diurno · Presencial')).toBeDefined();
});

test('contagem inclui somente matérias únicas que aparecem no fluxo', () => {
    client.setQueryData(curriculumQueryOptions(course.id, '2026.2').queryKey, {
        ...matrix,
        periods: [
            { period: 0, subjects: [{ code: 'FORA', name: 'Fora dos semestres' }] },
            {
                period: 1,
                subjects: [
                    { code: 'A', name: 'Base' },
                    { code: 'SEM_NOME', name: null },
                    { code: 'VAZIO', name: '   ' }
                ]
            },
            {
                period: 2,
                subjects: [
                    { code: 'A', name: 'Base repetida' },
                    { code: 'B', name: 'Prática' }
                ]
            }
        ],
        complementary: [{ code: 'OPT', name: 'Optativa fora do fluxo' }]
    });
    const page = renderSummary();
    expect(page.getByText('2 semestres · 2 matérias obrigatórias')).toBeDefined();
});

test('matriz vazia usa o singular e o plural corretos', () => {
    client.setQueryData(curriculumQueryOptions(course.id, '2026.2').queryKey, {
        ...matrix,
        periods: [{ period: 1, subjects: [{ code: 'A', name: 'Base' }] }]
    });
    const page = renderSummary();
    expect(page.getByText('1 semestre · 1 matéria obrigatória')).toBeDefined();
});

test('grau e modalidade ausentes na matriz são omitidos', () => {
    client.setQueryData(curriculumQueryOptions(course.id, '2026.2').queryKey, {
        ...matrix,
        degree: null,
        modality: null
    });
    const page = renderSummary();
    expect(page.getByText('Diurno')).toBeDefined();
    expect(page.queryByText('Bacharelado')).toBeNull();
});

test('usa a unidade recebida do perfil sem consultar o catálogo público', async () => {
    client.removeQueries({ queryKey: courseQueryOptions(course.id).queryKey });
    const page = renderSummary({
        course,
        entrySemester: '2026.2',
        unit: course.unit,
        fetchCourse: false
    });
    expect(page.getByText('FCTE').parentElement?.textContent).toBe('FCTE · Matriz 0123 - 2024.1');
    expect(page.getByText('Faculdade de Ciências e Tecnologias em Engenharia')).toBeDefined();
    expect(requests).toEqual([]);
});

test('exibe nota de corte PAS, média histórica, indicadores DPO e exportação no drawer', async () => {
    client.setQueryData(
        courseIndicatorsQueryOptions(course.id, matrix.degree, matrix.modality).queryKey,
        {
            course_id: course.id,
            pas_latest: 38.131,
            pas_average: 35.5,
            pas_cycle: '2023-2025',
            pas_history: [
                {
                    ciclo: '2023-2025',
                    sistema: 'Sistema Universal',
                    url: 'https://cdn.cebraspe.org.br/pas.pdf',
                    modalidades: [
                        { id: 'universal', sistema: 'Sistema Universal', descricao: 'Ampla' }
                    ],
                    nome: 'Engenharia de Software',
                    campus: 'FCTE',
                    grau: 'Bacharelado',
                    graus: ['Bacharelado'],
                    turno: 'Diurno',
                    minimo: '38.131',
                    maximo: '90.000',
                    pagina: 4,
                    ingresso_conjunto: true,
                    cotas: { universal: { minimo: '38.131', maximo: '90.000' } }
                },
                {
                    ciclo: '2022-2024',
                    sistema: 'Sistema Universal',
                    url: 'https://cdn.cebraspe.org.br/pas-2022.pdf',
                    modalidades: [],
                    nome: 'Engenharia de Software',
                    campus: 'FCTE',
                    grau: 'Bacharelado',
                    graus: ['Bacharelado'],
                    turno: 'Diurno',
                    minimo: '32.869',
                    maximo: '88.000',
                    pagina: 4,
                    ingresso_conjunto: true,
                    cotas: {}
                }
            ],
            latest_metrics: {
                ano: 2024,
                matriculados: 1193,
                ingressantes: 255,
                concluintes: 178,
                trancados: 58,
                desvinculados: 64,
                taxa_sucesso: 69.8,
                taxa_evasao: 5.36
            },
            historical_metrics: [
                {
                    ano: 2024,
                    matriculados: 1193,
                    ingressantes: 255,
                    concluintes: 178,
                    trancados: 58,
                    desvinculados: 64,
                    taxa_sucesso: 69.8,
                    taxa_evasao: 5.36
                }
            ],
            tamburetei_slug: 'engenharia-de-software-diurno',
            updated_at: '2026-11-25T03:00:00+00:00'
        }
    );
    const page = renderSummary();
    const pasTrigger = await page.findByRole('button', { name: /Nota de corte PAS/ });
    expect(pasTrigger.textContent).toContain('38,131');
    expect(pasTrigger.textContent).toContain('35,500');
    expect(pasTrigger.getAttribute('aria-expanded')).toBe('false');
    dom.testing.fireEvent.click(pasTrigger);
    await dom.testing.waitFor(() => expect(pasTrigger.getAttribute('aria-expanded')).toBe('true'));

    const statsTrigger = await page.findByRole('button', { name: /Estatísticas do curso/ });
    expect(statsTrigger.textContent).toContain('1.193 matriculados');
    expect(statsTrigger.textContent).toContain('69,8%');
    expect(statsTrigger.getAttribute('aria-expanded')).toBe('false');
});
