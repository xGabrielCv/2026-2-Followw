import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Navigate, createFileRoute, redirect } from '@tanstack/react-router';
import { useQueryState } from 'nuqs';
import { parseAsStringLiteral } from 'nuqs/server';

import type { UserProfile } from '#/queries/me';

import { ErrorCard, ErrorState, StaleDataNotice } from '#/components/ErrorState';
import { BackHeader } from '#/components/HeaderBar';
import { LoadingText } from '#/components/LoadingText';
import { AcademicSimulator } from '#/components/profile/AcademicSimulator';
import { IntegralizationSimulator } from '#/components/profile/IntegralizationSimulator';
import { currentRegularSemester } from '#/lib/offer';
import { nowInBrasilia } from '#/lib/schedule';
import { useAppConfig } from '#/queries/app-config';
import { appConfigQueryOptions, menuVisible } from '#/queries/app-config';
import { allClassroomsQueryOptions } from '#/queries/classrooms';
import { loadPersonal, loadQuery } from '#/queries/load';
import { meQueryOptions } from '#/queries/me';

export const Route = createFileRoute('/_app/perfil_/simulador')({
    head: () => ({ meta: [{ title: 'Simulador de IRA e MP | Followw' }] }),
    loader: async ({ context: { queryClient } }) => {
        const user = await loadQuery(queryClient, meQueryOptions);
        if (!user) throw redirect({ to: '/login' });
        if (user.level !== 'Graduação') throw redirect({ to: '/perfil' });
        await loadPersonal(queryClient, allClassroomsQueryOptions);
    },
    staticData: {
        header: () => <BackHeader to="/perfil" title="Simulador de IRA e MP" />
    },
    errorComponent: ErrorState,
    component: SimulatorPage
});

function SimulatorPage() {
    const { data: user } = useSuspenseQuery(meQueryOptions);
    const { data: config } = useQuery(appConfigQueryOptions);
    if (!user) return <Navigate to="/login" replace />;
    if (user.level !== 'Graduação' || !menuVisible(config, 'simulador_ira')) {
        return <Navigate to="/perfil" replace />;
    }
    return <SimulatorData user={user} />;
}

function SimulatorData({ user }: { user: UserProfile }) {
    const { calendar } = useAppConfig();
    const [view, setView] = useQueryState(
        'view',
        parseAsStringLiteral(['indexes', 'integralization']).withDefault('indexes')
    );
    const classrooms = useQuery(allClassroomsQueryOptions);
    if (classrooms.isLoadingError) {
        return (
            <ErrorCard
                message="Não foi possível carregar suas disciplinas."
                onRetry={() => classrooms.refetch()}
            />
        );
    }
    if (classrooms.isPending) return <LoadingText>Carregando disciplinas...</LoadingText>;

    const current =
        classrooms.data.find((classroom) => classroom.current)?.semester ??
        currentRegularSemester(nowInBrasilia().date, calendar);
    return (
        <>
            {classrooms.isError && <StaleDataNotice subject="as disciplinas" />}
            {view === 'integralization' ? (
                <IntegralizationSimulator
                    key={`${user.registration}:${current}`}
                    user={user}
                    classrooms={classrooms.data}
                    semester={current}
                    onBack={() => void setView('indexes')}
                />
            ) : (
                <AcademicSimulator
                    onIntegralization={() => void setView('integralization')}
                    classrooms={classrooms.data}
                    entry={user.entry_semester}
                    current={current}
                    curriculum={
                        user.curriculum_subject_codes?.length
                            ? new Set(user.curriculum_subject_codes)
                            : null
                    }
                />
            )}
        </>
    );
}
