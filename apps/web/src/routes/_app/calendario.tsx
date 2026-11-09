import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useQueryStates } from 'nuqs';
import { createParser, createStandardSchemaV1 } from 'nuqs/server';
import { useMemo, useState } from 'react';

import type { SubjectOption } from '#/components/calendar/EntryDialog';
import type { DayMarks } from '#/components/calendar/MonthGrid';
import type { CalendarEntry } from '#/queries/events';

import { DayDetails } from '#/components/calendar/DayDetails';
import { EntryDialog } from '#/components/calendar/EntryDialog';
import { MonthGrid } from '#/components/calendar/MonthGrid';
import { ErrorState } from '#/components/ErrorState';
import { HeaderBar, HeaderTitle } from '#/components/HeaderBar';
import { ListCard } from '#/components/ListCard';
import { useAgenda } from '#/components/schedule/useAgenda';
import { SectionHeader } from '#/components/SectionHeader';
import {
    ENTRY_KINDS,
    academicEventsOn,
    addMonths,
    daysUntil,
    entriesOn,
    formatClock,
    relativeDays
} from '#/lib/agenda';
import { validDate } from '#/lib/date';
import { nowInBrasilia } from '#/lib/schedule';
import { cn } from '#/lib/shadcn';
import { classroomsQueryOptions } from '#/queries/classrooms';
import { useCalendarEntries } from '#/queries/events';
import { loadPersonal, loadQuery } from '#/queries/load';
import { meQueryOptions } from '#/queries/me';

const calendarParsers = {
    date: createParser({
        parse: (value) => (validDate(value) ? value : null),
        serialize: String
    })
};

export const Route = createFileRoute('/_app/calendario')({
    validateSearch: createStandardSchemaV1(calendarParsers, { partialOutput: true }),
    shouldReload: ({ cause }) => cause !== 'stay',
    head: () => ({ meta: [{ title: 'Calendário | Followw' }] }),
    loader: async ({ context: { queryClient } }) => {
        const user = await loadQuery(queryClient, meQueryOptions);
        if (user) await loadPersonal(queryClient, classroomsQueryOptions);
    },
    staticData: {
        header: () => (
            <HeaderBar>
                <HeaderTitle>Calendário</HeaderTitle>
            </HeaderBar>
        ),
        wide: true
    },
    errorComponent: ErrorState,
    component: CalendarPage
});

function CalendarPage() {
    const today = nowInBrasilia().date;
    const [search, setSearch] = useQueryStates(calendarParsers, {
        history: 'replace',
        scroll: false
    });
    const selected = search.date ?? today;
    const month = selected.slice(0, 7);

    const { data: user } = useSuspenseQuery(meQueryOptions);
    const classroomsQuery = useQuery({ ...classroomsQueryOptions, enabled: Boolean(user) });
    const classrooms = useMemo(() => classroomsQuery.data ?? [], [classroomsQuery.data]);
    const entries = useCalendarEntries().data ?? [];
    const agendaOf = useAgenda(classrooms);

    const [dialog, setDialog] = useState<{ open: boolean; entry?: CalendarEntry }>({ open: false });

    const select = (date: string) => void setSearch({ date: date === today ? null : date });
    const changeMonth = (step: number) => {
        const next = addMonths(month, step);
        select(next === today.slice(0, 7) ? today : `${next}-01`);
    };
    const marks = (date: string): DayMarks => ({
        academic: academicEventsOn(date),
        entries: entriesOn(entries, date)
    });
    const day = agendaOf(selected);
    const subjects: SubjectOption[] = classrooms.map(({ subject }) => ({
        code: subject.code,
        name: subject.name
    }));

    return (
        <div className="flex flex-col gap-6 pb-4 desk:grid desk:grid-cols-[minmax(0,1fr)_24rem] desk:items-start desk:gap-8">
            <MonthGrid
                month={month}
                selected={selected}
                today={today}
                marks={marks}
                onSelect={select}
                onMonth={changeMonth}
            />
            <div className="flex flex-col gap-6">
                <DayDetails
                    date={selected}
                    loggedIn={Boolean(user)}
                    academic={academicEventsOn(selected)}
                    classes={day.classes}
                    preview={day.preview}
                    entries={entriesOn(entries, selected)}
                    colorOf={day.colorOf}
                    onAdd={() => setDialog({ open: true })}
                    onEdit={(entry) => setDialog({ open: true, entry })}
                />
                <Upcoming entries={entries} today={today} onSelect={select} />
            </div>
            <EntryDialog
                open={dialog.open}
                onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
                date={selected}
                entry={dialog.entry}
                subjects={subjects}
            />
        </div>
    );
}

const UPCOMING = 6;

/** As próximas provas, entregas e eventos lançados, para ter o panorama sem abrir dia a dia. */
function Upcoming({
    entries,
    today,
    onSelect
}: {
    entries: CalendarEntry[];
    today: string;
    onSelect: (date: string) => void;
}) {
    const next = entries.filter((entry) => entry.date >= today).slice(0, UPCOMING);
    if (next.length === 0) return null;
    return (
        <section aria-label="Próximos lançamentos">
            <SectionHeader title="Próximos" />
            <ListCard>
                {next.map((entry) => {
                    const kind = ENTRY_KINDS[entry.kind ?? 'evento'];
                    return (
                        <button
                            key={entry.id}
                            type="button"
                            onClick={() => onSelect(entry.date)}
                            className="flex w-full items-center gap-3 py-2.5 text-left hover:opacity-80"
                        >
                            <span className={cn('size-2 shrink-0 rounded-full', kind.solid)} />
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate text-sm font-medium">{entry.title}</span>
                                <span className="text-xs text-muted-foreground">
                                    {[
                                        kind.label,
                                        `${entry.date.slice(8)}/${entry.date.slice(5, 7)}`,
                                        entry.time && formatClock(entry.time)
                                    ]
                                        .filter(Boolean)
                                        .join(' · ')}
                                </span>
                            </span>
                            <span className="shrink-0 text-xs font-semibold text-primary">
                                {relativeDays(daysUntil(today, entry.date))}
                            </span>
                        </button>
                    );
                })}
            </ListCard>
        </section>
    );
}
