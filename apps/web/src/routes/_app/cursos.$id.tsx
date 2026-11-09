import { noop, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Link, createFileRoute, notFound, rootRouteId } from '@tanstack/react-router';
import { ChartColumn, ChevronRight } from 'lucide-react';

import { CourseSummary } from '#/components/curriculum/CourseSummary';
import { CurriculumView } from '#/components/curriculum/CurriculumView';
import { Legend } from '#/components/curriculum/Legend';
import { ErrorCard, ErrorState } from '#/components/ErrorState';
import { BackHeader } from '#/components/HeaderBar';
import { LoadingText } from '#/components/LoadingText';
import { useFlowSearch, validateFlowSearch } from '#/lib/curriculum/navigation';
import { flowTarget, parseCourseId } from '#/lib/curriculum/target';
import { titleCase } from '#/lib/profile';
import { useWidth } from '#/lib/width';
import { allClassroomsQueryOptions } from '#/queries/classrooms';
import { courseQueryOptions } from '#/queries/courses';
import { curriculumQueryOptions } from '#/queries/curriculum';
import { ApiError } from '#/queries/errors';
import { loadPersonal, loadQuery } from '#/queries/load';
import { meQueryOptions } from '#/queries/me';

const DESKTOP_MIN_WIDTH = 1024;

export const Route = createFileRoute('/_app/cursos/$id')({
    validateSearch: validateFlowSearch,
    staticData: { presentation: 'fullscreen' },
    params: {
        parse: ({ id }) => {
            const courseId = parseCourseId(id);
            if (courseId === null) throw notFound({ routeId: rootRouteId });
            return { id: courseId };
        },
        stringify: ({ id }) => ({ id: String(id) })
    },
    loader: async ({ context: { queryClient }, params: { id: courseId } }) => {
        const user = await loadQuery(queryClient, meQueryOptions);
        const { ownCourse, loggedIn, entrySemester } = flowTarget(user, courseId);
        const [course] = await Promise.all([
            ownCourse
                ? user?.course
                : loadQuery(queryClient, courseQueryOptions(courseId)).catch(noop),
            entrySemester &&
                loadQuery(queryClient, curriculumQueryOptions(courseId, entrySemester)).catch(noop),
            loggedIn && entrySemester && loadPersonal(queryClient, allClassroomsQueryOptions)
        ]);
        return { courseName: course?.name };
    },
    head: ({ loaderData }) => ({
        meta: [
            {
                title: loaderData?.courseName
                    ? `Fluxograma de ${titleCase(loaderData.courseName)} | Followw`
                    : 'Fluxograma | Followw'
            }
        ]
    }),
    pendingComponent: () => (
        <div className="flex flex-col gap-4 px-4 desk:px-6">
            <FlowHeader />
            <LoadingText>Carregando fluxo...</LoadingText>
        </div>
    ),
    errorComponent: (props) => (
        <div className="flex flex-col gap-4 px-4 desk:px-6">
            <FlowHeader />
            <ErrorState {...props} />
        </div>
    ),
    component: FlowPage
});

function FlowHeader({ legend = false }: { legend?: boolean }) {
    return <BackHeader to="/buscar" title="Fluxo acadêmico" actions={legend && <Legend />} />;
}

/** Atalho bem visível para as estatísticas do fluxo (antes era um botão pequeno no cabeçalho). */
function StatisticsShortcut({ courseId }: { courseId: number }) {
    return (
        <Link
            to="/cursos/$id/estatisticas"
            params={{ id: courseId }}
            className="mt-3 flex items-center gap-3 rounded-2xl bg-primary/10 p-3 ring-1 ring-primary/20 transition-colors outline-none hover:ring-primary/50 focus-visible:ring-2 focus-visible:ring-ring"
        >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <ChartColumn className="size-5" aria-hidden="true" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-semibold">Ver estatísticas do seu fluxo</span>
                <span className="text-xs text-muted-foreground">
                    Progresso, matérias atrasadas e planejamento da formatura
                </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>
    );
}

function FlowPage() {
    const { ref, width } = useWidth<HTMLDivElement>();
    const desktop = width ? width >= DESKTOP_MIN_WIDTH : null;
    const [{ subject }] = useFlowSearch();
    const { data: user } = useSuspenseQuery(meQueryOptions);
    const { id: courseId } = Route.useParams();
    const { ownCourse, loggedIn, entrySemester, currentPeriod } = flowTarget(user, courseId);
    const listed = useQuery({ ...courseQueryOptions(courseId), enabled: !ownCourse });
    const unlisted = listed.error instanceof ApiError && listed.error.isNotFound;
    const course = ownCourse ? user?.course : listed.data;
    return (
        <div ref={ref} className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 px-4 pb-5 desk:px-6">
                <FlowHeader legend={Boolean(desktop && loggedIn && course && entrySemester)} />
                {course && <CourseSummary course={course} entrySemester={entrySemester} />}
                {ownCourse && loggedIn && entrySemester && (
                    <StatisticsShortcut courseId={courseId} />
                )}
            </div>
            {!ownCourse && listed.isPending ? (
                <LoadingText className="p-4">Carregando curso...</LoadingText>
            ) : !ownCourse && listed.isLoadingError && !unlisted ? (
                <div className="p-4">
                    <ErrorCard
                        message="Não foi possível carregar o curso."
                        onRetry={() => listed.refetch()}
                    />
                </div>
            ) : !course ? (
                <p className="p-4">Curso não encontrado no catálogo.</p>
            ) : !entrySemester ? (
                <p className="p-4">
                    Semestre de referência indisponível. Não foi possível identificar a matriz deste
                    curso.
                </p>
            ) : (
                <CurriculumView
                    key={course.id}
                    courseId={course.id}
                    entrySemester={entrySemester}
                    currentPeriod={currentPeriod}
                    selected={subject ?? undefined}
                    ownCourse={ownCourse}
                    loggedIn={loggedIn}
                    desktop={desktop}
                />
            )}
        </div>
    );
}
