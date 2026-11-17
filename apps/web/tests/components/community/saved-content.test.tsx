import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
    createMemoryHistory,
    createRootRoute,
    createRouter,
    RouterContextProvider
} from '@tanstack/react-router';
import { afterEach, expect, spyOn, test } from 'bun:test';

import { GroupsContent } from '#/components/community/GroupsDialog';
import {
    ProfessorReviewsSection,
    ReviewsBrowser
} from '#/components/community/ProfessorReviewsSection';
import { SubjectMaterialsPanel } from '#/components/materials/SubjectMaterialsPanel';
import { forumPostQueryOptions, subjectMaterialsQueryOptions } from '#/queries/community';
import { classroomGroupsQueryOptions } from '#/queries/groups';
import { meQueryOptions } from '#/queries/me';
import { professorReviewsQueryOptions } from '#/queries/reviews';
import { Route } from '#/routes/_app/comunidade_.$id';

import { useDom } from '../../helpers/dom';

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
    }
];

function render(client: QueryClient, children: ReactNode) {
    const router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() });
    return dom.testing.render(
        <QueryClientProvider client={client}>
            <RouterContextProvider router={router}>{children}</RouterContextProvider>
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
            }
        });
    }
}
