import { noop, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, notFound, redirect, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useEffect } from 'react';

import { ClassroomTeachingPlanPage } from '#/components/classroom/ClassroomTeachingPlanPage';
import {
    ErrorCard,
    ErrorState,
    SIGAA_DOWN_MESSAGE,
    StaleDataNotice
} from '#/components/ErrorState';
import { LoadingText } from '#/components/LoadingText';
import { OfflineBanner } from '#/components/OfflineBanner';
import { SystemNoticeBanner } from '#/components/SystemNoticeBanner';
import { Card, CardContent } from '#/components/ui/card';
import { allClassroomsQueryOptions, classroomTeachingPlanQueryOptions } from '#/queries/classrooms';
import { loadPersonal, loadQuery } from '#/queries/load';
import { meQueryOptions } from '#/queries/me';

export const Route = createFileRoute('/turmas_/$id_/plano-de-ensino')({
    loader: async ({ context: { queryClient }, params: { id } }) => {
        const user = await loadQuery(queryClient, meQueryOptions);
        if (!user) throw redirect({ to: '/login' });
        const classrooms = await loadPersonal(queryClient, allClassroomsQueryOptions);
        const classroom = classrooms?.find((item) => item.id === id);
        if (classrooms && !classroom) throw notFound();
        if (classroom) {
            const cachedPlan = queryClient.getQueryData(
                classroomTeachingPlanQueryOptions(id).queryKey
            );
            if (cachedPlan === null) {
                throw redirect({ to: '/turmas/$id', params: { id } });
            }
            await loadPersonal(queryClient, classroomTeachingPlanQueryOptions(id)).catch(noop);
        }
        return { subjectName: classroom?.subject.name };
    },
    head: ({ loaderData }) => ({
        meta: [
            {
                title: `Plano de ensino · ${loaderData?.subjectName ?? 'Turma'} | Followw`
            }
        ]
    }),
    errorComponent: ErrorState,
    component: TeachingPlanPage
});

function TeachingPlanPage() {
    const { id } = Route.useParams();
    const navigate = useNavigate();
    const { data: user } = useSuspenseQuery(meQueryOptions);
    const classrooms = useQuery({ ...allClassroomsQueryOptions, enabled: Boolean(user) });
    const classroom = classrooms.data?.find((item) => item.id === id);
    const plan = useQuery({
        ...classroomTeachingPlanQueryOptions(id),
        enabled: Boolean(user && classroom)
    });

    const missingPlan = Boolean(classroom && plan.status === 'success' && plan.data === null);

    useEffect(() => {
        if (missingPlan) {
            void navigate({ to: '/turmas/$id', params: { id }, replace: true });
        }
    }, [id, missingPlan, navigate]);

    if (classroom && plan.data) {
        return (
            <ClassroomTeachingPlanPage
                classroom={classroom}
                plan={plan.data}
                notice={
                    <>
                        <OfflineBanner />
                        <SystemNoticeBanner />
                        {plan.isError && <StaleDataNotice subject="o plano de ensino" />}
                    </>
                }
            />
        );
    }

    return (
        <main className="min-h-dvh bg-background px-4 py-8 text-foreground desk:px-6 desk:py-10">
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 forced-mobile:max-w-md">
                <Link
                    to="/turmas/$id"
                    params={{ id }}
                    className="flex w-fit items-center gap-2 text-sm text-primary underline-offset-4 hover:underline"
                >
                    <ArrowLeft className="size-4" aria-hidden />
                    Voltar à turma
                </Link>
                <OfflineBanner />
                {classrooms.isLoadingError ? (
                    <ErrorCard
                        message={SIGAA_DOWN_MESSAGE}
                        onRetry={() => void classrooms.refetch()}
                    />
                ) : classrooms.isPending ? (
                    <StatusCard>
                        <LoadingText>Carregando turma...</LoadingText>
                    </StatusCard>
                ) : !classroom ? (
                    <StatusCard>Turma não encontrada.</StatusCard>
                ) : plan.isLoadingError ? (
                    <ErrorCard message={SIGAA_DOWN_MESSAGE} onRetry={() => void plan.refetch()} />
                ) : missingPlan ? (
                    <StatusCard>Esta turma ainda não possui um plano cadastrado.</StatusCard>
                ) : (
                    <StatusCard>
                        <LoadingText>Carregando plano de ensino...</LoadingText>
                    </StatusCard>
                )}
            </div>
        </main>
    );
}

function StatusCard({ children }: { children: React.ReactNode }) {
    return (
        <Card size="sm">
            <CardContent className="text-center text-sm text-muted-foreground">
                {children}
            </CardContent>
        </Card>
    );
}
