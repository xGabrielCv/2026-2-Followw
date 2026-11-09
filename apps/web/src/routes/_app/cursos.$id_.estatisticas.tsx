import { noop, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Link, createFileRoute, notFound, rootRouteId } from '@tanstack/react-router';
import { useMemo } from 'react';

import { CourseSummary } from '#/components/curriculum/CourseSummary';
import { FlowStatisticsView } from '#/components/curriculum/FlowStatistics';
import { GraduationPlanner } from '#/components/curriculum/GraduationPlanner';
import { ErrorState } from '#/components/ErrorState';
import { BackHeader } from '#/components/HeaderBar';
import { QueryState } from '#/components/QueryState';
import { academicState, normalizeCurriculum } from '#/lib/curriculum/model';
import { flowStatistics, historyStatistics } from '#/lib/curriculum/statistics';
import { flowTarget, parseCourseId } from '#/lib/curriculum/target';
import { currentRegularSemester } from '#/lib/offer';
import { nowInBrasilia } from '#/lib/schedule';
import { allClassroomsQueryOptions } from '#/queries/classrooms';
import { curriculumQueryOptions } from '#/queries/curriculum';
import { loadPersonal, loadQuery } from '#/queries/load';
import { meQueryOptions } from '#/queries/me';
import { useCompletedSubjects } from '#/queries/settings';

export const Route = createFileRoute('/_app/cursos/$id_/estatisticas')({
    params: {
        parse: ({ id }) => {
            const courseId = parseCourseId(id);
            if (courseId === null) throw notFound({ routeId: rootRouteId });
            return { id: courseId };
        },
        stringify: ({ id }) => ({ id: String(id) })
    },
    head: () => ({ meta: [{ title: 'Estatísticas do fluxo | Followw' }] }),
    loader: async ({ context: { queryClient }, params: { id } }) => {
        const user = await loadQuery(queryClient, meQueryOptions);
        const { ownCourse, entrySemester } = flowTarget(user, id);
        if (!ownCourse || !entrySemester) return;
        await Promise.all([
            loadQuery(queryClient, curriculumQueryOptions(id, entrySemester)).catch(noop),
            loadPersonal(queryClient, allClassroomsQueryOptions)
        ]);
    },
    staticData: {
        header: () => <BackHeader to="/perfil" title="Estatísticas do fluxo" />,
        wide: true
    },
    errorComponent: ErrorState,
    component: FlowStatisticsPage
});

function FlowStatisticsPage() {
    const { id } = Route.useParams();
    const { data: user } = useSuspenseQuery(meQueryOptions);
    const { ownCourse, entrySemester, currentPeriod } = flowTarget(user, id);
    const enabled = ownCourse && Boolean(entrySemester);
    const matrix = useQuery({
        ...curriculumQueryOptions(id, entrySemester ?? ''),
        enabled
    });
    const history = useQuery({ ...allClassroomsQueryOptions, enabled });
    const { codes } = useCompletedSubjects();
    const planning = useMemo(() => {
        if (!matrix.data || !history.data) return null;
        const model = normalizeCurriculum(matrix.data);
        return { model, state: academicState(history.data, currentPeriod, codes) };
    }, [matrix.data, history.data, currentPeriod, codes]);
    const flow = useMemo(
        () => (planning ? flowStatistics(planning.model, planning.state) : null),
        [planning]
    );
    const past = useMemo(
        () => (history.data ? historyStatistics(history.data) : undefined),
        [history.data]
    );

    if (!user || !enabled || !user.course)
        return (
            <p className="text-sm text-muted-foreground">
                As estatísticas ficam disponíveis no fluxo do seu próprio curso, com login.{' '}
                <Link to="/cursos/$id" params={{ id }} className="font-bold text-primary">
                    Voltar ao fluxo
                </Link>
            </p>
        );

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
                <CourseSummary course={user.course} entrySemester={entrySemester} />
                <Link
                    to="/cursos/$id"
                    params={{ id }}
                    className="self-start text-sm font-semibold text-primary hover:underline"
                >
                    Ver fluxograma
                </Link>
            </div>
            <div className="flex flex-col gap-2 text-sm empty:hidden">
                <QueryState
                    query={matrix}
                    loading="Carregando matriz..."
                    error="Não foi possível carregar a matriz curricular."
                    stale="Não foi possível atualizar a matriz. Exibindo os dados salvos."
                />
                <QueryState
                    query={history}
                    loading="Carregando histórico..."
                    error="Histórico indisponível; não foi possível calcular as estatísticas."
                    stale="Não foi possível atualizar o histórico. Exibindo os dados salvos."
                />
            </div>
            {flow && (
                <FlowStatisticsView
                    flow={flow}
                    history={past}
                    user={user}
                    semester={currentRegularSemester(nowInBrasilia().date)}
                    manualCount={codes.size}
                />
            )}
            {planning && (
                <GraduationPlanner
                    model={planning.model}
                    state={planning.state}
                    semester={currentRegularSemester(nowInBrasilia().date)}
                />
            )}
        </div>
    );
}
