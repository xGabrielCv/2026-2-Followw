import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Copy, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useQueryStates } from 'nuqs';
import { createParser, createStandardSchemaV1 } from 'nuqs/server';
import { useMemo, useState, useSyncExternalStore } from 'react';

import type { SchedulePlan } from '#/lib/planned-schedule';

import { useProfessorRatings } from '#/components/community/RatingBadge';
import { BackHeader } from '#/components/HeaderBar';
import { PlannedClassList } from '#/components/schedule/PlannedClassList';
import { SuggestedPlans } from '#/components/schedule/SuggestedPlans';
import { usePlannedSchedule } from '#/components/schedule/usePlannedSchedule';
import { WeeklyTable } from '#/components/schedule/WeeklyTable';
import { TabFilter } from '#/components/TabFilter';
import { Button, buttonVariants } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { currentRegularSemester, nextRegularSemester } from '#/lib/offer';
import {
    activePlan,
    createPlan,
    deletePlan,
    MAX_PLANS,
    renamePlan,
    schedulePlans,
    selectPlan,
    weeklyGrid
} from '#/lib/planned-schedule';
import { formatRating, ratingTone } from '#/lib/reviews';
import { nowInBrasilia } from '#/lib/schedule';
import { averageRating, planMetrics } from '#/lib/schedule-compare';
import { cn } from '#/lib/shadcn';
import { allClassroomsQueryOptions } from '#/queries/classrooms';
import { meQueryOptions } from '#/queries/me';
import { useUserSettings } from '#/queries/settings';
import { approvedCodes } from '#/queries/subjects';

const simuladorParsers = {
    semester: createParser({
        parse: (value) => (/^\d{4}\.\d$/.test(value) ? value : null),
        serialize: String
    })
};

export const Route = createFileRoute('/_app/simulador')({
    validateSearch: createStandardSchemaV1(simuladorParsers, { partialOutput: true }),
    head: () => ({ meta: [{ title: 'Simulador de grades | Followw' }] }),
    staticData: {
        header: () => <BackHeader to="/mais" title="Simulador de grades" />
    },
    component: SimuladorPage
});

const EMPTY_PLANS = { active: '', plans: [] as SchedulePlan[] };

function SimuladorPage() {
    const value = useSyncExternalStore(
        schedulePlans.subscribe,
        schedulePlans.getSnapshot,
        () => EMPTY_PLANS
    );
    const { maxHours, toggle } = usePlannedSchedule();
    const { data: user } = useQuery(meQueryOptions);
    const history = useQuery({ ...allClassroomsQueryOptions, enabled: Boolean(user) });
    const { completedSubjects } = useUserSettings();
    const completedCodes = useMemo(
        () => [...new Set([...approvedCodes(history.data ?? []), ...(completedSubjects ?? [])])],
        [history.data, completedSubjects]
    );
    const [{ semester: picked }, setSearch] = useQueryStates(simuladorParsers, {
        history: 'replace',
        scroll: false
    });
    const current = currentRegularSemester(nowInBrasilia().date);
    const options = current ? [nextRegularSemester(current), current] : [];
    const semester = picked && options.includes(picked) ? picked : options[0];
    const [editing, setEditing] = useState(false);
    const active = value.plans.length ? activePlan(value) : undefined;
    const items = active?.items.filter((item) => item.semester === semester) ?? [];
    const grid = weeklyGrid(items)[0];

    return (
        <div className="flex flex-col gap-4 pb-8">
            <p className="text-sm text-muted-foreground">
                Monte até {MAX_PLANS} grades diferentes e compare. A grade escolhida aqui é a que a
                Busca completa e que aparece em Minhas Turmas.
            </p>
            {options.length > 1 && (
                <TabFilter
                    label="Semestre"
                    value={semester}
                    options={options}
                    optionClassName={(option) =>
                        option === options[0] ? 'text-primary' : undefined
                    }
                    onChange={(option) =>
                        void setSearch({ semester: option === options[0] ? null : option })
                    }
                    className="-my-2"
                />
            )}
            <fieldset
                className="flex items-center gap-2 overflow-x-auto pb-1 max-md:no-scrollbar"
                aria-label="Grades"
            >
                {value.plans.map((plan) => (
                    <button
                        key={plan.id}
                        type="button"
                        aria-pressed={plan.id === active?.id}
                        onClick={() => {
                            selectPlan(plan.id);
                            setEditing(false);
                        }}
                        className={cn(
                            'flex shrink-0 flex-col items-start rounded-2xl px-3 py-2 text-left ring-1 transition-colors',
                            plan.id === active?.id
                                ? 'bg-primary/10 ring-primary/50'
                                : 'bg-card ring-foreground/8 hover:ring-primary/30'
                        )}
                    >
                        <span className="text-sm font-semibold">{plan.name}</span>
                        <span className="text-xs text-muted-foreground">
                            {plan.items.filter((item) => item.semester === semester).length} turmas
                        </span>
                    </button>
                ))}
                {value.plans.length < MAX_PLANS && (
                    <Button
                        variant="outline"
                        className="h-auto shrink-0 self-stretch"
                        onClick={() => createPlan()}
                    >
                        <Plus aria-hidden="true" />
                        Nova grade
                    </Button>
                )}
            </fieldset>
            {active && (
                <section
                    aria-label={`Grade ${active.name}`}
                    className="flex flex-col gap-3 rounded-2xl bg-card p-4 shadow-card ring-1 ring-foreground/8"
                >
                    {editing ? (
                        <RenameForm plan={active} onDone={() => setEditing(false)} />
                    ) : (
                        <div className="flex items-center justify-between gap-2">
                            <h2 className="min-w-0 truncate text-base font-semibold">
                                {active.name}
                            </h2>
                            <div className="flex shrink-0 gap-1">
                                <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    aria-label="Renomear grade"
                                    onClick={() => setEditing(true)}
                                >
                                    <Pencil aria-hidden="true" />
                                </Button>
                                <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    aria-label="Duplicar grade"
                                    disabled={value.plans.length >= MAX_PLANS}
                                    onClick={() => createPlan(active.id)}
                                >
                                    <Copy aria-hidden="true" />
                                </Button>
                                <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    className="text-destructive"
                                    aria-label="Apagar grade"
                                    onClick={() => {
                                        if (window.confirm(`Apagar "${active.name}"?`))
                                            deletePlan(active.id);
                                    }}
                                >
                                    <Trash2 aria-hidden="true" />
                                </Button>
                            </div>
                        </div>
                    )}
                    {semester && (
                        <Link
                            to="/buscar"
                            search={{ semester }}
                            className={cn(buttonVariants({ variant: 'default' }), 'self-start')}
                        >
                            <Search aria-hidden="true" />
                            Adicionar turmas de {semester} na Busca
                        </Link>
                    )}
                    {grid ? (
                        <>
                            <div className="overflow-x-auto">
                                <WeeklyTable grid={grid} maxHours={maxHours} />
                            </div>
                            <PlannedClassList items={items} onRemove={toggle} />
                        </>
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            Nenhuma turma de {semester} nesta grade ainda.
                        </p>
                    )}
                </section>
            )}
            {semester && (
                <SuggestedPlans
                    plans={value.plans}
                    semester={semester}
                    maxHours={maxHours}
                    completedCodes={completedCodes}
                />
            )}
            {semester && value.plans.length > 1 && (
                <Comparison plans={value.plans} semester={semester} activeId={active?.id} />
            )}
        </div>
    );
}

function RenameForm({ plan, onDone }: { plan: SchedulePlan; onDone: () => void }) {
    const [name, setName] = useState(plan.name);
    return (
        <form
            className="flex gap-2"
            onSubmit={(event) => {
                event.preventDefault();
                renamePlan(plan.id, name);
                onDone();
            }}
        >
            <Input
                value={name}
                maxLength={40}
                aria-label="Nome da grade"
                onChange={(event) => setName(event.target.value)}
            />
            <Button type="submit" disabled={!name.trim()}>
                Salvar
            </Button>
        </form>
    );
}

const hours = (minutes: number) => `${Math.round(minutes / 6) / 10}h`.replace('.', ',');

/** Uma coluna por grade: o que muda entre elas no semestre escolhido. */
export function Comparison({
    plans,
    semester,
    activeId
}: {
    plans: SchedulePlan[];
    semester: string;
    activeId?: string;
}) {
    const ofSemester = plans.map((plan) => ({
        plan,
        items: plan.items.filter((item) => item.semester === semester)
    }));
    const ratings = useProfessorRatings(
        ofSemester.flatMap(({ items }) =>
            items.flatMap((item) => item.professors.map(({ siape }) => siape))
        )
    );
    const columns = ofSemester.map(({ plan, items }) => ({
        plan,
        metrics: planMetrics(items),
        rating: averageRating(items, ratings)
    }));
    const rows: [string, (column: (typeof columns)[number]) => React.ReactNode][] = [
        ['Turmas', ({ metrics }) => metrics.classes],
        ['Carga horária', ({ metrics }) => `${metrics.hours}h`],
        ['Aula por semana', ({ metrics }) => hours(metrics.minutes)],
        ['Dias com aula', ({ metrics }) => metrics.days],
        ['Dias livres (seg–sex)', ({ metrics }) => metrics.freeWeekdays],
        [
            'Manhã · tarde · noite',
            ({ metrics }) => `${metrics.morning} · ${metrics.afternoon} · ${metrics.night}`
        ],
        ['Começa às', ({ metrics }) => metrics.earliest ?? '—'],
        ['Termina às', ({ metrics }) => metrics.latest ?? '—'],
        [
            'Nota média dos docentes',
            ({ rating }) =>
                rating == null ? (
                    <span className="text-muted-foreground">sem notas</span>
                ) : (
                    <span className={cn('font-semibold', ratingTone(rating))}>
                        {formatRating(rating)}
                    </span>
                )
        ]
    ];
    return (
        <section aria-label="Comparar grades" className="flex flex-col gap-2">
            <h2 className="px-1 text-base font-semibold">Comparar grades de {semester}</h2>
            <div className="overflow-x-auto rounded-2xl bg-card shadow-card ring-1 ring-foreground/8">
                <table className="w-full min-w-max text-sm">
                    <thead>
                        <tr className="border-b">
                            <th className="sticky left-0 bg-card px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                                <span className="sr-only">Medida</span>
                            </th>
                            {columns.map(({ plan }) => (
                                <th
                                    key={plan.id}
                                    scope="col"
                                    className={cn(
                                        'px-3 py-2 text-left font-semibold',
                                        plan.id === activeId && 'text-primary'
                                    )}
                                >
                                    <button
                                        type="button"
                                        onClick={() => selectPlan(plan.id)}
                                        className="hover:underline"
                                    >
                                        {plan.name}
                                    </button>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(([label, cell]) => (
                            <tr key={label} className="border-b last:border-0">
                                <th
                                    scope="row"
                                    className="sticky left-0 bg-card px-3 py-2 text-left text-xs font-medium text-muted-foreground"
                                >
                                    {label}
                                </th>
                                {columns.map((column) => (
                                    <td key={column.plan.id} className="px-3 py-2 tabular-nums">
                                        {cell(column)}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="px-1 text-xs text-muted-foreground">
                Toque no nome de uma grade para usá-la na Busca e em Minhas Turmas.
            </p>
        </section>
    );
}
