import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
    createMemoryHistory,
    createRootRoute,
    createRouter,
    RouterContextProvider
} from '@tanstack/react-router';
import { afterEach, expect, spyOn, test } from 'bun:test';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';

import { GroupsContent } from '#/components/community/GroupsDialog';
import {
    ProfessorReviewsSection,
    ReviewsBrowser
} from '#/components/community/ProfessorReviewsSection';
import { SubjectMaterialsPanel } from '#/components/materials/SubjectMaterialsPanel';
import { allClassroomsQueryOptions } from '#/queries/classrooms';
import {
    forumPostQueryOptions,
    materialSubjectsQueryOptions,
    subjectMaterialsQueryOptions,
    tutorialQueryOptions,
    tutorialsQueryOptions
} from '#/queries/community';
import { comparisonQueryOptions } from '#/queries/comparison';
import { classroomGroupsQueryOptions } from '#/queries/groups';
import { meQueryOptions } from '#/queries/me';
import { professorReviewsQueryOptions } from '#/queries/reviews';
import { Route } from '#/routes/_app/comunidade_.$id';
import { Route as EstatisticasRoute } from '#/routes/_app/estatisticas';
import { Route as GuiasRoute } from '#/routes/_app/guias';
import { Route as GuiaRoute } from '#/routes/_app/guias_.$id';
import { Route as MateriaisRoute } from '#/routes/_app/materiais';

import { useDom } from '../../helpers/dom';
import { userProfile } from '../../helpers/profile';

const dom = useDom();
const clients: QueryClient[] = [];
afterEach(() => {
    dom.testing.cleanup();
    for (const client of clients.splice(0)) client.clear();
});

const classroom = { code: 'FGA0030', semester: '2026.2', number: '01' };
const reviews = {
    total: 1,
    page: 1,
    page_size: 20,
    summary: { count: 1, average: 85, attendance: { cobra: 1, nao_cobra: 0, varia: 0 } },
    reviews: [
        {
            id: 'r1',
            rating: 85,
            comment: 'Comentário salvo',
            attendance: 'cobra',
            semester: null,
            criteria: null,
            subject: null,
            month: '2026-11'
        }
    ]
};
const cases = [
    {
        name: 'grupos',
        key: classroomGroupsQueryOptions(classroom).queryKey,
        data: {
            classroom,
            groups: [
                {
                    id: 'g1',
                    platform: 'whatsapp',
                    url: 'https://chat.whatsapp.com/AbC',
                    password: null
                }
            ]
        },
        content: 'WhatsApp',
        error: 'Não foi possível carregar os grupos.',
        render: () => <GroupsContent classroom={classroom} />
    },
    {
        name: 'materiais',
        key: subjectMaterialsQueryOptions('FGA0030').queryKey,
        data: {
            subject: { code: 'FGA0030', name: 'Matéria' },
            oldest_semester: '2024.1',
            limits: {
                max_file_bytes: 20000000,
                max_daily_upload_attempts: 10,
                max_per_subject: 30,
                max_subject_bytes: 30000000,
                keep_semesters: 6
            },
            usage: { files: 1, bytes: 100, mine: 0 },
            items: [
                {
                    id: 'm1',
                    title: 'Material salvo',
                    kind: 'prova',
                    semester: '2026.2',
                    classroom_number: null,
                    professors: [],
                    filename: 'prova.pdf',
                    mime: 'application/pdf',
                    size: 100,
                    month: '2026-11',
                    mine: false
                }
            ]
        },
        content: 'Material salvo',
        error: 'Não foi possível carregar os materiais.',
        render: () => <SubjectMaterialsPanel code="FGA0030" />
    },
    {
        name: 'resumo de avaliações',
        key: professorReviewsQueryOptions(111).queryKey,
        data: reviews,
        content: 'Ver avaliações completas',
        error: 'Não foi possível carregar as avaliações.',
        render: () => <ProfessorReviewsSection siape={111} name="Docente" />
    },
    {
        name: 'lista de avaliações',
        key: professorReviewsQueryOptions(111, { page: 1 }).queryKey,
        data: reviews,
        content: 'Comentário salvo',
        error: 'Tentar carregar novamente',
        render: () => <ReviewsBrowser siape={111} />
    },
    {
        name: 'detalhe da conversa',
        key: forumPostQueryOptions('p1').queryKey,
        data: {
            id: 'p1',
            kind: 'duvida',
            title: 'Conversa salva',
            body: 'Texto salvo',
            excerpt: 'Texto salvo',
            resolved: false,
            mine: false,
            campus: null,
            course: null,
            subject: null,
            reply_count: 0,
            replies: [],
            created_at: '2026-11-17T12:00:00Z',
            last_activity_at: '2026-11-17T12:00:00Z'
        },
        content: 'Conversa salva',
        error: 'Conversa não encontrada ou indisponível.',
        render: () => {
            const Component = Route.options.component!;
            return <Component />;
        }
    },
    {
        name: 'lista de guias',
        key: tutorialsQueryOptions(undefined, undefined).queryKey,
        data: [
            {
                id: 't1',
                title: 'Guia salvo de matrícula',
                summary: 'Resumo salvo',
                category: 'matricula',
                published_at: '2026-11-17T12:00:00Z'
            }
        ],
        content: 'Guia salvo de matrícula',
        error: 'Não foi possível carregar os guias.',
        render: () => {
            const Component = GuiasRoute.options.component!;
            return <Component />;
        }
    },
    {
        name: 'detalhe do guia',
        key: tutorialQueryOptions('p1').queryKey,
        data: {
            id: 'p1',
            title: 'Guia completo salvo',
            summary: 'Resumo',
            body: 'Conteúdo salvo',
            category: 'matricula',
            published_at: '2026-11-17T12:00:00Z'
        },
        content: 'Guia completo salvo',
        error: 'Guia não encontrado.',
        render: () => {
            const Component = GuiaRoute.options.component!;
            return <Component />;
        }
    },
    {
        name: 'matérias com material',
        key: materialSubjectsQueryOptions(undefined).queryKey,
        data: [{ code: 'FGA0030', name: 'Estruturas Salvas', files: 2 }],
        content: 'Estruturas Salvas',
        error: 'Não foi possível carregar as matérias.',
        render: () => {
            const Component = MateriaisRoute.options.component!;
            return <Component />;
        }
    }
];

function render(client: QueryClient, children: ReactNode) {
    const router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() });
    return dom.testing.render(
        <QueryClientProvider client={client}>
            <RouterContextProvider router={router}>
                <NuqsTestingAdapter hasMemory>{children}</NuqsTestingAdapter>
            </RouterContextProvider>
        </QueryClientProvider>
    );
}

for (const scenario of cases) {
    for (const saved of [true, false]) {
        test(`${scenario.name}: falha ${saved ? 'preserva conteúdo e avisa da cópia salva' : 'sem cache mantém erro sem inventar dados'}`, async () => {
            const client = new QueryClient({
                defaultOptions: {
                    queries: {
                        retry: false,
                        retryOnMount: false,
                        refetchOnMount: false,
                        staleTime: Infinity
                    }
                }
            });
            clients.push(client);
            client.setQueryData(meQueryOptions.queryKey, null);
            const options = { queryKey: scenario.key };
            const query = client.getQueryCache().build(client, options);
            if (saved) client.setQueryData(scenario.key, scenario.data);
            query.setState({
                status: 'error',
                error: new Error('Falha simulada'),
                fetchStatus: 'idle'
            });
            const params = spyOn(Route, 'useParams').mockReturnValue({ id: 'p1' });
            const guiaParams = spyOn(GuiaRoute, 'useParams').mockReturnValue({ id: 'p1' });
            try {
                const page = render(client, scenario.render());
                if (saved) {
                    expect(page.baseElement.textContent).toContain(scenario.content);
                    expect(page.baseElement.textContent).toContain('Exibindo os dados salvos.');
                } else {
                    expect(page.baseElement.textContent).toContain(scenario.error);
                    expect(page.baseElement.textContent).not.toContain('Exibindo os dados salvos.');
                    expect(page.baseElement.textContent).not.toContain(scenario.content);
                }
            } finally {
                params.mockRestore();
                guiaParams.mockRestore();
            }
        });
    }
}

test('estatísticas comparadas avisam quando o histórico falha sem cache em vez de exibir zero matérias', () => {
    const client = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
                retryOnMount: false,
                refetchOnMount: false,
                staleTime: Infinity
            }
        }
    });
    clients.push(client);
    client.setQueryData(meQueryOptions.queryKey, userProfile());
    client.setQueryData(comparisonQueryOptions(1).queryKey, {
        course: { approved: 80, failed: 20, dropped: 0, classrooms: 10 },
        unb: { approved: 75, failed: 25, dropped: 0, classrooms: 100 },
        subjects: []
    });
    const historyQuery = client.getQueryCache().build(client, {
        queryKey: allClassroomsQueryOptions.queryKey
    });
    historyQuery.setState({
        status: 'error',
        error: new Error('SIGAA indisponível'),
        fetchStatus: 'idle'
    });
    const Component = EstatisticasRoute.options.component!;
    const page = render(client, <Component />);
    expect(page.baseElement.textContent).not.toContain('0 matérias suas com dados');
    expect(page.baseElement.textContent).toContain('SIGAA');
});
