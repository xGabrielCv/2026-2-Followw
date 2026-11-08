import { type QueryClient, noop, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQueryStates } from 'nuqs';

import type { Rating } from '#/queries/reviews';
import type { components } from '#/queries/schema.gen';

import { ClassroomPosts } from '#/components/classroom/ClassroomPosts';
import { ClassroomStatistics } from '#/components/classroom/ClassroomStatistics';
import { ClassroomSummary } from '#/components/classroom/ClassroomSummary';
import { FrequencyContent } from '#/components/classroom/FrequencyContent';
import { SubjectColorPicker } from '#/components/classroom/SubjectColorPicker';
import { ClassroomCommunity } from '#/components/community/ClassroomCommunity';
import { RatingBadge, useProfessorRatings } from '#/components/community/RatingBadge';
import {
    ErrorCard,
    ErrorState,
    SIGAA_DOWN_MESSAGE,
    StaleDataNotice
} from '#/components/ErrorState';
import { BackHeader } from '#/components/HeaderBar';
import { LoginPromptCard } from '#/components/home/LoginPromptCard';
import { ListCard } from '#/components/ListCard';
import { LoadingText } from '#/components/LoadingText';
import { SubjectMaterialsPanel } from '#/components/materials/SubjectMaterialsPanel';
import { SubjectOutcomesSection } from '#/components/OutcomeRates';
import { Card, CardContent } from '#/components/ui/card';
import { PersonPhoto } from '#/components/ui/person-photo';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs';
import { automaticColorIndex } from '#/lib/agenda';
import {
    CLASSROOM_TABS,
    classroomTab,
    type ClassroomTab,
    classroomSearchParsers,
    loadClassroomSearch,
    validateClassroomSearch
} from '#/lib/classroom-search';
import { mailto } from '#/lib/contact';
import { withMarks } from '#/lib/lesson-marks';
import { titleCase } from '#/lib/profile';
import {
    allClassroomsQueryOptions,
    classroomFrequencyQueryOptions,
    classroomMembersQueryOptions,
    classroomPostsQueryOptions,
    classroomStatisticsQueryOptions,
    useLessonMarks
} from '#/queries/classrooms';
import { loadPersonal, loadQuery } from '#/queries/load';
import { meQueryOptions } from '#/queries/me';

type Member = components['schemas']['ClassroomMember'];
type Professor = components['schemas']['ProfessorRef'];

const TAB_LABELS: Record<ClassroomTab, string> = {
    frequency: 'Frequência',
    statistics: 'Estatísticas',
    posts: 'Postagens',
    materials: 'Material',
    members: 'Pessoas'
};

// a aba aberta é pré-carregada; as outras buscam ao serem abertas
const PRELOAD_TAB: Record<ClassroomTab, (client: QueryClient, id: string) => Promise<unknown>> = {
    frequency: (client, id) => loadPersonal(client, classroomFrequencyQueryOptions(id)),
    statistics: (client, id) =>
        Promise.all([
            loadPersonal(client, classroomStatisticsQueryOptions(id)),
            loadPersonal(client, classroomFrequencyQueryOptions(id))
        ]),
    posts: (client, id) => loadPersonal(client, classroomPostsQueryOptions(id)),
    // o material é da matéria, não da turma: carrega ao abrir a aba
    materials: () => Promise.resolve(),
    members: (client, id) => loadPersonal(client, classroomMembersQueryOptions(id))
};

export const Route = createFileRoute('/_app/turmas_/$id')({
    validateSearch: validateClassroomSearch,
    // Trocar de aba só muda a URL: o componente consulta a aba.
    shouldReload: ({ cause }) => cause !== 'stay',
    loader: async ({ context: { queryClient }, params, location }) => {
        const user = await loadQuery(queryClient, meQueryOptions);
        // turmas vêm do SIGAA na hora: a página abre com o que o navegador já tem
        const classrooms = user
            ? await loadPersonal(queryClient, allClassroomsQueryOptions)
            : undefined;
        const classroom = classrooms?.find(({ id }) => id === params.id);
        if (classroom) {
            const { tab } = loadClassroomSearch(location.searchStr);
            await PRELOAD_TAB[classroomTab(tab, classroom.current)](
                queryClient,
                classroom.id
            ).catch(noop);
        }
        return { subjectName: classroom?.subject.name };
    },
    head: ({ loaderData }) => ({
        meta: [{ title: `${loaderData?.subjectName ?? 'Turma'} | Followw` }]
    }),
    staticData: {
        header: () => <BackHeader to="/turmas" title="Minhas Turmas" />
    },
    errorComponent: ErrorState,
    component: ClassroomPage
});

function ClassroomPage() {
    const { id } = Route.useParams();
    const { data: user } = useSuspenseQuery(meQueryOptions);
    const classrooms = useQuery({ ...allClassroomsQueryOptions, enabled: Boolean(user) });
    const [{ tab }, setSearch] = useQueryStates(classroomSearchParsers, {
        history: 'replace',
        scroll: false
    });
    const classroom = classrooms.data?.find((item) => item.id === id);

    return (
        <>
            {!user ? (
                <LoginPromptCard />
            ) : classrooms.isLoadingError ? (
                <ErrorCard message={SIGAA_DOWN_MESSAGE} onRetry={() => classrooms.refetch()} />
            ) : classrooms.isPending ? (
                <InformationCard>
                    <LoadingText>Carregando turma...</LoadingText>
                </InformationCard>
            ) : !classroom ? (
                <InformationCard>Turma não encontrada.</InformationCard>
            ) : (
                <>
                    <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                            <ClassroomSummary classroom={classroom} />
                        </div>
                        <ClassroomCommunity
                            className="w-38 shrink-0 desk:w-56"
                            code={classroom.subject.code}
                            semester={classroom.semester}
                            number={classroom.number}
                            name={classroom.subject.name}
                            professors={classroom.professors}
                        />
                    </div>
                    {classroom.current && (
                        <div className="mt-3">
                            <SubjectColorPicker
                                code={classroom.subject.code}
                                automatic={automaticColorIndex(
                                    (classrooms.data ?? [])
                                        .filter((item) => item.current)
                                        .map((item) => item.subject.code),
                                    classroom.subject.code
                                )}
                            />
                        </div>
                    )}
                    <Tabs
                        value={classroomTab(tab, classroom.current)}
                        onValueChange={(value: ClassroomTab) => void setSearch({ tab: value })}
                        className="mt-5 gap-4"
                    >
                        <TabsList
                            variant="line"
                            className="grid w-full grid-cols-4 border-b border-border group-data-horizontal/tabs:h-auto"
                            aria-label="Detalhes da turma"
                        >
                            {CLASSROOM_TABS.filter(
                                (item) => classroomTab(item, classroom.current) === item
                            ).map((item) => (
                                <TabsTrigger
                                    key={item}
                                    value={item}
                                    className="h-auto min-w-0 px-1 py-2 text-xs after:bg-primary data-active:text-primary desk:text-sm"
                                >
                                    {TAB_LABELS[item]}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                        <TabsContent value="posts">
                            <ClassroomPosts key={id} id={id} />
                        </TabsContent>
                        {classroom.current ? (
                            <TabsContent value="frequency">
                                <FrequencyTab id={id} />
                            </TabsContent>
                        ) : (
                            <TabsContent value="statistics">
                                <ClassroomStatistics id={id} />
                            </TabsContent>
                        )}
                        <TabsContent value="materials">
                            <SubjectMaterialsPanel
                                code={classroom.subject.code}
                                classroom={{
                                    semester: classroom.semester,
                                    number: classroom.number,
                                    professors: classroom.professors.map(({ name }) => name)
                                }}
                            />
                        </TabsContent>
                        <TabsContent value="members">
                            <MembersTab id={id} />
                        </TabsContent>
                    </Tabs>
                    <div className="mt-6 pb-4">
                        <SubjectOutcomesSection
                            code={classroom.subject.code}
                            professors={classroom.professors.map(({ name }) => name)}
                        />
                    </div>
                </>
            )}
        </>
    );
}

function TabLoading() {
    return (
        <InformationCard>
            <LoadingText>Carregando informações...</LoadingText>
        </InformationCard>
    );
}

function InformationCard({ children }: { children: React.ReactNode }) {
    return (
        <Card size="sm">
            <CardContent className="text-center text-sm text-muted-foreground">
                {children}
            </CardContent>
        </Card>
    );
}

function TabError({ onRetry }: { onRetry: () => void }) {
    return <ErrorCard message={SIGAA_DOWN_MESSAGE} onRetry={onRetry} />;
}

function FrequencyTab({ id }: { id: string }) {
    const frequency = useQuery(classroomFrequencyQueryOptions(id));
    const { marks, mark } = useLessonMarks(id);

    if (frequency.isPending) return <TabLoading />;
    if (frequency.isLoadingError) return <TabError onRetry={() => frequency.refetch()} />;

    return (
        <>
            {frequency.isError && <StaleDataNotice subject="a frequência" className="mb-2" />}
            <FrequencyContent
                data={withMarks(frequency.data, marks)}
                pending={false}
                onMark={(lessons, status) =>
                    mark(
                        lessons.map((lesson) => lesson.id),
                        status
                    )
                }
            />
        </>
    );
}

function GroupTitle({ title, count }: { title: string; count: number }) {
    return (
        <h3 className="mb-2 px-1 text-sm font-semibold">
            {title} <span className="font-normal text-muted-foreground">{count}</span>
        </h3>
    );
}

function MembersTab({ id }: { id: string }) {
    const members = useQuery(classroomMembersQueryOptions(id));

    if (members.isPending) return <TabLoading />;
    if (members.isLoadingError) return <TabError onRetry={() => members.refetch()} />;
    const { professors, monitors, students } = members.data;
    return <Members professors={professors} monitors={monitors} students={students} />;
}

function Members({
    professors,
    monitors,
    students
}: {
    professors: Professor[];
    monitors: Member[];
    students: Member[];
}) {
    const ratings = useProfessorRatings(professors.map(({ siape }) => siape));
    if (professors.length + monitors.length + students.length === 0)
        return <InformationCard>Nenhum participante encontrado.</InformationCard>;

    return (
        <div className="flex flex-col gap-4">
            <MemberGroup title="Professores" count={professors.length}>
                {professors.map((professor) => (
                    <ProfessorRow
                        key={professor.siape ?? professor.name}
                        professor={professor}
                        rating={professor.siape == null ? undefined : ratings[professor.siape]}
                    />
                ))}
            </MemberGroup>
            <MemberGroup title="Monitores" count={monitors.length}>
                {monitors.map((member) => (
                    <MemberRow key={member.registration} member={member} />
                ))}
            </MemberGroup>
            <MemberGroup title="Estudantes" count={students.length}>
                {students.map((member) => (
                    <MemberRow key={member.registration} member={member} />
                ))}
            </MemberGroup>
        </div>
    );
}

function MemberGroup({
    title,
    count,
    children
}: {
    title: string;
    count: number;
    children: React.ReactNode;
}) {
    if (count === 0) return null;
    return (
        <section>
            <GroupTitle title={title} count={count} />
            <ListCard>{children}</ListCard>
        </section>
    );
}

function ProfessorRow({ professor, rating }: { professor: Professor; rating?: Rating }) {
    const name = titleCase(professor.name);
    return (
        <PersonRow
            photo={professor.photo}
            name={
                professor.siape == null ? (
                    name
                ) : (
                    <>
                        <Link
                            to="/professores/$siape"
                            params={{ siape: professor.siape }}
                            className="hover:text-primary"
                        >
                            {name}
                        </Link>{' '}
                        <RatingBadge rating={rating} />
                    </>
                )
            }
            email={professor.email}
        />
    );
}

function MemberRow({ member }: { member: Member }) {
    return (
        <PersonRow
            photo={member.photo}
            name={titleCase(member.name)}
            details={[member.course && titleCase(member.course.name), member.registration]
                .filter(Boolean)
                .join(' · ')}
            email={member.email}
        />
    );
}

function PersonRow({
    photo,
    name,
    details,
    email
}: {
    photo?: string | null;
    name: React.ReactNode;
    details?: string;
    email?: string | null;
}) {
    return (
        <div className="flex items-center gap-3 py-2.5">
            <PersonPhoto src={photo} />
            <div className="min-w-0 text-xs text-muted-foreground">
                <p className="truncate text-sm font-medium text-foreground">{name}</p>
                {details && <p className="truncate">{details}</p>}
                {email && (
                    <a className="break-all text-primary" href={mailto(email)}>
                        {email}
                    </a>
                )}
            </div>
        </div>
    );
}
