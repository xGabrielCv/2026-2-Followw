import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQueryStates } from 'nuqs';
import { createParser, createStandardSchemaV1 } from 'nuqs/server';

import { CachedAbsenceBadge } from '#/components/classroom/AbsenceAlert';
import { ErrorCard, ErrorState, SIGAA_DOWN_MESSAGE } from '#/components/ErrorState';
import { HeaderBar, HeaderTitle } from '#/components/HeaderBar';
import { ClassCard } from '#/components/home/ClassCard';
import { LoginPromptCard } from '#/components/home/LoginPromptCard';
import { LoadingText } from '#/components/LoadingText';
import { PlannedSemester } from '#/components/schedule/PlannedSemester';
import { TabFilter } from '#/components/TabFilter';
import { Card, CardContent } from '#/components/ui/card';
import { groupBySemester } from '#/lib/classroom-details';
import { currentRegularSemester, nextRegularSemester } from '#/lib/offer';
import { describeSchedule, nowInBrasilia } from '#/lib/schedule';
import { allClassroomsQueryOptions, finalGrade } from '#/queries/classrooms';
import { loadPersonal, loadQuery } from '#/queries/load';
import { meQueryOptions } from '#/queries/me';

const turmasParsers = {
    // semestre escolhido; o futuro mostra a grade planejada na busca
    semester: createParser({
        parse: (value) => (/^\d{4}\.\d$/.test(value) ? value : null),
        serialize: String
    })
};

export const Route = createFileRoute('/_app/turmas')({
    validateSearch: createStandardSchemaV1(turmasParsers, { partialOutput: true }),
    head: () => ({ meta: [{ title: 'Minhas Turmas | Followw' }] }),
    loader: async ({ context: { queryClient } }) => {
        const user = await loadQuery(queryClient, meQueryOptions);
        if (user) await loadPersonal(queryClient, allClassroomsQueryOptions);
    },
    staticData: {
        header: () => (
            <HeaderBar>
                <HeaderTitle>Minhas Turmas</HeaderTitle>
            </HeaderBar>
        )
    },
    errorComponent: ErrorState,
    component: TurmasPage
});

function TurmasPage() {
    const { data: user } = useSuspenseQuery(meQueryOptions);

    return user ? <Classrooms /> : <LoginPromptCard />;
}

function Classrooms() {
    const navigate = useNavigate();
    const {
        data: classrooms,
        isPending,
        isLoadingError,
        refetch
    } = useQuery(allClassroomsQueryOptions);
    const [{ semester: selected }, setSearch] = useQueryStates(turmasParsers, {
        history: 'replace',
        scroll: false
    });

    const groups = groupBySemester(classrooms ?? []);
    const current = currentRegularSemester(nowInBrasilia().date);
    // o próximo semestre, à esquerda, até as turmas dele chegarem do SIGAA
    const future =
        current && !groups.some(([name]) => name === nextRegularSemester(current))
            ? nextRegularSemester(current)
            : undefined;
    const options = [...(future ? [future] : []), ...groups.map(([name]) => name)];
    const planning = future !== undefined && selected === future;
    const [semester, items] = planning
        ? [future, undefined]
        : (groups.find(([name]) => name === selected) ?? groups[0] ?? []);

    if (isLoadingError) return <ErrorCard message={SIGAA_DOWN_MESSAGE} onRetry={() => refetch()} />;

    return (
        <>
            {options.length > 0 && (
                <TabFilter
                    label="Escolher semestre"
                    value={semester}
                    options={options}
                    onChange={(value) =>
                        void setSearch({ semester: value === groups[0]?.[0] ? null : value })
                    }
                    optionClassName={(option) => (option === future ? 'text-primary' : undefined)}
                    className="mb-2"
                />
            )}
            {planning && <PlannedSemester semester={future} />}
            <div className="flex flex-col gap-2">
                {items?.map((classroom) => (
                    <ClassCard
                        key={classroom.id}
                        title={classroom.subject.name}
                        code={classroom.subject.code}
                        time={describeSchedule(classroom.schedule) ?? 'Horário a definir'}
                        location={
                            classroom.current
                                ? (classroom.room ?? 'Local não informado')
                                : undefined
                        }
                        classNumber={classroom.number}
                        grade={finalGrade(classroom)}
                        status={classroom.status === 'pending_enrollment' ? 'pending' : 'normal'}
                        indicator={
                            classroom.current ? <CachedAbsenceBadge id={classroom.id} /> : undefined
                        }
                        onClick={() =>
                            navigate({ to: '/turmas/$id', params: { id: classroom.id } })
                        }
                    />
                ))}
            </div>
            {!planning && (isPending || classrooms.length === 0) && (
                <Card>
                    <CardContent className="text-center text-sm text-muted-foreground">
                        {isPending ? (
                            <LoadingText>Carregando turmas...</LoadingText>
                        ) : (
                            'Nenhuma turma encontrada.'
                        )}
                    </CardContent>
                </Card>
            )}
        </>
    );
}
