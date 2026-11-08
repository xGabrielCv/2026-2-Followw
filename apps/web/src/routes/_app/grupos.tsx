import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useQueryStates } from 'nuqs';
import {
    createParser,
    createStandardSchemaV1,
    parseAsBoolean,
    parseAsString,
    parseAsStringLiteral
} from 'nuqs/server';
import { useState } from 'react';

import type { Campus, GroupedClassroom } from '#/queries/groups';

import { GroupsDialog } from '#/components/community/GroupsDialog';
import { WhatsAppIcon } from '#/components/community/PlatformIcon';
import { ErrorCard, ErrorState } from '#/components/ErrorState';
import { BackHeader } from '#/components/HeaderBar';
import { LoadingText } from '#/components/LoadingText';
import { TabFilter } from '#/components/TabFilter';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { CAMPUS_LABELS, CAMPUSES, campusOfUnit } from '#/lib/campus';
import { useDebounced } from '#/lib/debounce';
import { offerChoices } from '#/lib/offer';
import { titleCase } from '#/lib/profile';
import { describeSchedule, nowInBrasilia } from '#/lib/schedule';
import { cn } from '#/lib/shadcn';
import { api } from '#/queries/api';
import { meQueryOptions } from '#/queries/me';
import { offerSemestersQueryOptions } from '#/queries/subjects';

const ALL = 'all';
type CampusFilter = Campus | typeof ALL;
const CAMPUS_OPTIONS: CampusFilter[] = [ALL, ...CAMPUSES];
const CAMPUS_FILTER_LABELS: Record<CampusFilter, string> = { all: 'Todos', ...CAMPUS_LABELS };

const gruposParsers = {
    q: parseAsString.withDefault(''),
    // sem ele, o campus do curso do aluno
    region: parseAsStringLiteral(CAMPUS_OPTIONS),
    semester: createParser({
        parse: (value) => (/^\d{4}\.\d$/.test(value) ? value : null),
        serialize: String
    }),
    with: parseAsBoolean.withDefault(false)
};

export const Route = createFileRoute('/_app/grupos')({
    validateSearch: createStandardSchemaV1(gruposParsers, { partialOutput: true }),
    head: () => ({ meta: [{ title: 'Grupos das turmas | Followw' }] }),
    staticData: {
        header: () => <BackHeader to="/mais" title="Grupos das turmas" />
    },
    errorComponent: ErrorState,
    component: GruposPage
});

function GruposPage() {
    const { data: user } = useSuspenseQuery(meQueryOptions);
    return <Groups unitId={user?.unit?.id} />;
}

function Groups({ unitId }: { unitId?: number }) {
    const [search, setSearch] = useQueryStates(gruposParsers, {
        history: 'replace',
        scroll: false
    });
    const { data: offer } = useQuery(offerSemestersQueryOptions);
    const semesters = offerChoices(offer ?? [], nowInBrasilia().date)
        .choices.filter(({ available }) => available)
        .map(({ semester }) => semester);
    const semester =
        search.semester && semesters.includes(search.semester) ? search.semester : semesters[0];
    const campus = search.region ?? campusOfUnit(unitId) ?? ALL;
    const text = useDebounced(search.q.trim());

    return (
        <div className="flex flex-col gap-4 pb-8">
            <div className="relative">
                <Search
                    className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                />
                <Input
                    type="search"
                    value={search.q}
                    maxLength={32}
                    onChange={(event) => void setSearch({ q: event.target.value || null })}
                    placeholder="Matéria ou código..."
                    aria-label="Buscar matéria pelo nome ou código"
                    className="h-11 bg-card pl-10 text-sm"
                />
            </div>
            <div className="-my-2 flex flex-col">
                {semesters.length > 1 && (
                    <TabFilter
                        label="Semestre"
                        value={semester}
                        options={semesters}
                        onChange={(value) =>
                            void setSearch({ semester: value === semesters[0] ? null : value })
                        }
                    />
                )}
                <TabFilter
                    label="Campus"
                    value={campus}
                    options={CAMPUS_OPTIONS}
                    labels={CAMPUS_FILTER_LABELS}
                    onChange={(value) => void setSearch({ region: value })}
                />
                <TabFilter
                    label="Mostrar"
                    value={search.with ? 'with' : 'all'}
                    options={['all', 'with'] as const}
                    labels={{ all: 'Todas as turmas', with: 'Só com grupos' }}
                    onChange={(value) => void setSearch({ with: value === 'with' || null })}
                />
            </div>
            {semester ? (
                <GroupList
                    semester={semester}
                    q={text.length >= 3 ? text : undefined}
                    campus={campus === ALL ? undefined : campus}
                    withGroups={search.with}
                />
            ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                    Nenhuma oferta de turmas carregada ainda.
                </p>
            )}
        </div>
    );
}

function GroupList({
    semester,
    q,
    campus,
    withGroups
}: {
    semester: string;
    q?: string;
    campus?: Campus;
    withGroups: boolean;
}) {
    const [open, setOpen] = useState<GroupedClassroom | null>(null);
    const pages = api.useInfiniteQuery(
        'get',
        '/groups',
        { params: { query: { semester, q, campus, with_groups: withGroups || undefined } } },
        {
            initialPageParam: 1,
            pageParamName: 'page',
            getNextPageParam: (last) =>
                last.page * last.page_size < last.total ? last.page + 1 : undefined
        }
    );

    if (pages.isPending) return <LoadingText>Carregando turmas...</LoadingText>;
    if (pages.isError)
        return (
            <ErrorCard
                message="Não foi possível carregar as turmas."
                onRetry={() => pages.refetch()}
            />
        );

    const items = pages.data.pages.flatMap((page) => page.items);
    const total = pages.data.pages[0]?.total ?? 0;
    if (items.length === 0)
        return (
            <p className="py-8 text-center text-sm text-muted-foreground">
                {withGroups
                    ? 'Nenhuma turma com grupo cadastrado nesse filtro.'
                    : 'Nenhuma turma encontrada.'}
            </p>
        );

    return (
        <section aria-label="Turmas" className="flex flex-col gap-2">
            <p className="px-1 text-xs text-muted-foreground">
                {total} {total === 1 ? 'turma' : 'turmas'} · toque para ver os grupos
            </p>
            <ul className="flex flex-col gap-2">
                {items.map((item) => (
                    <li key={`${item.code}-${item.number}`}>
                        <GroupedClassroomCard item={item} onOpen={() => setOpen(item)} />
                    </li>
                ))}
            </ul>
            {pages.hasNextPage && (
                <Button
                    variant="outline"
                    className="self-center"
                    disabled={pages.isFetchingNextPage}
                    onClick={() => void pages.fetchNextPage()}
                >
                    {pages.isFetchingNextPage ? 'Carregando...' : 'Mostrar mais'}
                </Button>
            )}
            {open && (
                <GroupsDialog
                    code={open.code}
                    semester={open.semester}
                    number={open.number}
                    name={open.name}
                    open
                    onOpenChange={(value) => !value && setOpen(null)}
                />
            )}
        </section>
    );
}

function GroupedClassroomCard({ item, onOpen }: { item: GroupedClassroom; onOpen: () => void }) {
    const professors = item.professors.map(titleCase).join(', ');
    return (
        <button
            type="button"
            onClick={onOpen}
            className="flex w-full items-center gap-3 rounded-2xl bg-card p-3 text-left shadow-card ring-1 ring-foreground/8 transition-colors outline-none hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Grupos de ${item.name}, turma ${item.number}`}
        >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-xs text-muted-foreground tabular-nums">
                    <span className="font-semibold text-primary">{item.code}</span>
                    {` · T${item.number} · ${describeSchedule(item.schedule) ?? 'Horário a definir'}`}
                </span>
                <span className="truncate text-sm font-semibold">{item.name}</span>
                {professors && (
                    <span className="truncate text-xs text-muted-foreground">{professors}</span>
                )}
            </span>
            <span
                className={cn(
                    'flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold',
                    item.groups > 0
                        ? 'bg-success/10 text-success'
                        : 'bg-muted text-muted-foreground'
                )}
            >
                <WhatsAppIcon className="size-3.5" />
                {item.groups > 0 ? item.groups : 'Sem grupo'}
            </span>
        </button>
    );
}
