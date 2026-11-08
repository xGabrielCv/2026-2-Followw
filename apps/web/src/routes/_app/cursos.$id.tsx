import { noop, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Link, createFileRoute, notFound, rootRouteId } from '@tanstack/react-router';
import { ChartColumn } from 'lucide-react';

import { CourseSummary } from '#/components/curriculum/CourseSummary';
import { CurriculumView } from '#/components/curriculum/CurriculumView';
import { Legend } from '#/components/curriculum/Legend';
import { ErrorCard, ErrorState } from '#/components/ErrorState';
import { BackHeader } from '#/components/HeaderBar';
import { LoadingText } from '#/components/LoadingText';
import { buttonVariants } from '#/components/ui/button';
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

function FlowHeader({ legend = false, stats }: { legend?: boolean; stats?: number }) {
    return (
        <BackHeader
            to="/buscar"
            title="Fluxo acadêmico"
            actions={
                (legend || stats !== undefined) && (
                    <>
                        {legend && <Legend />}
                        {stats !== undefined && (
                            <Link
                                to="/cursos/$id/estatisticas"
                                params={{ id: stats }}
                                className={buttonVariants({ variant: 'outline', size: 'sm' })}
                            >
                                <ChartColumn aria-hidden="true" />
                                Estatísticas
                            </Link>
                        )}
                    </>
                )
            }
        />
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
                <FlowHeader
                    legend={Boolean(desktop && loggedIn && course && entrySemester)}
                    stats={ownCourse && loggedIn && entrySemester ? courseId : undefined}
                />
                {course && <CourseSummary course={course} entrySemester={entrySemester} />}
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
