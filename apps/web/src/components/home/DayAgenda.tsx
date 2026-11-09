import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, MapPin } from 'lucide-react';
import { Fragment } from 'react';

import type { CalendarEvent } from '#/calendar';
import type { AgendaItem, SubjectColor } from '#/lib/agenda';
import type { ScheduledClass } from '#/lib/schedule';
import type { CalendarEntry } from '#/queries/events';

import { ErrorCard, SIGAA_DOWN_MESSAGE } from '#/components/ErrorState';
import { LoginPromptCard } from '#/components/home/LoginPromptCard';
import { Badge } from '#/components/ui/badge';
import { Button } from '#/components/ui/button';
import { ENTRY_KINDS, dayLabel, formatClock, isNoClass } from '#/lib/agenda';
import { countdown, useClock } from '#/lib/countdown';
import { addDays, dayOverview, formatDuration, weekDays } from '#/lib/schedule';
import { cn } from '#/lib/shadcn';

const LETTERS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const NO_EVENTS: CalendarEvent[] = [];

interface DayAgendaProps {
    date: string;
    today: string;
    onSelect: (date: string) => void;
    loggedIn: boolean;
    noClassReason?: string;
    isLoadingError: boolean;
    onRetry: () => void;
    classes: ScheduledClass<AgendaItem>[];
    // aulas da grade planejada na busca, antes de haver turmas do semestre no SIGAA
    preview?: boolean;
    entries: CalendarEntry[];
    // datas do calendário da UnB no dia (prazos, eventos); os feriados vêm no noClassReason
    academic?: CalendarEvent[];
    colorOf: (code: string) => SubjectColor;
}

/** A grade do dia escolhido em cards coloridos, com a semana e as setas para trocar de dia. */
export function DayAgenda(props: DayAgendaProps) {
    const { date, today, onSelect } = props;
    const isToday = date === today;
    return (
        <section aria-label="Agenda do dia" className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                    <h2 className="text-lg font-semibold tracking-tight">Agenda do dia</h2>
                    <p className="truncate text-xs text-muted-foreground first-letter:uppercase">
                        {dayLabel(date)}
                    </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    {!isToday && (
                        <Button variant="ghost" size="sm" onClick={() => onSelect(today)}>
                            Hoje
                        </Button>
                    )}
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => onSelect(addDays(date, -1))}
                        aria-label="Dia anterior"
                    >
                        <ChevronLeft />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => onSelect(addDays(date, 1))}
                        aria-label="Próximo dia"
                    >
                        <ChevronRight />
                    </Button>
                </div>
            </div>
            <WeekStrip date={date} today={today} onSelect={onSelect} />
            <AgendaContent {...props} />
        </section>
    );
}

function WeekStrip({
    date,
    today,
    onSelect
}: {
    date: string;
    today: string;
    onSelect: (date: string) => void;
}) {
    return (
        <div className="grid grid-cols-7 gap-1" aria-label="Dias da semana">
            {weekDays(date, 7).map((day) => {
                const selected = day.date === date;
                return (
                    <button
                        key={day.date}
                        type="button"
                        onClick={() => onSelect(day.date)}
                        aria-label={`${LETTERS[day.weekday]}${Number(day.date.slice(8))}: ${dayLabel(day.date)}`}
                        aria-pressed={selected}
                        className="group flex flex-col items-center gap-1 rounded-xl py-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                        <span className="text-xs font-semibold text-muted-foreground">
                            {LETTERS[day.weekday]}
                        </span>
                        <span
                            className={cn(
                                'flex size-9 items-center justify-center rounded-full text-base font-semibold tabular-nums transition-colors group-hover:bg-muted',
                                selected &&
                                    'bg-primary text-primary-foreground group-hover:bg-primary',
                                !selected &&
                                    day.date === today &&
                                    'text-primary ring-1 ring-primary/40',
                                day.weekday === 0 && !selected && 'text-muted-foreground'
                            )}
                        >
                            {Number(day.date.slice(8))}
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

function AgendaContent({
    loggedIn,
    noClassReason,
    isLoadingError,
    onRetry,
    classes,
    preview = false,
    entries,
    academic = NO_EVENTS,
    colorOf
}: DayAgendaProps) {
    const navigate = useNavigate();
    const { gaps } = dayOverview(classes);
    const dates = academic.filter((event) => !isNoClass(event));

    if (!loggedIn) return <LoginPromptCard />;
    if (isLoadingError) return <ErrorCard message={SIGAA_DOWN_MESSAGE} onRetry={onRetry} />;

    return (
        <div className="flex flex-col gap-2">
            {dates.map((event) => (
                <Link
                    key={`${event.name}-${event.start_date}`}
                    to="/calendario"
                    search={{ date: event.start_date }}
                    className="flex items-center gap-3 rounded-2xl bg-muted/60 p-3 text-sm hover:opacity-85"
                >
                    <CalendarDays
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">{event.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">UnB</span>
                </Link>
            ))}
            {entries.map((entry) => (
                <EntryCard key={entry.id} entry={entry} />
            ))}
            {preview && classes.length > 0 && (
                <p className="px-1 text-xs text-primary">
                    Prévia da grade que você montou na busca; vira a sua agenda real quando as
                    turmas aparecerem no SIGAA.
                </p>
            )}
            {classes.length === 0 ? (
                <div className="rounded-2xl bg-card p-4">
                    <p className="font-semibold">Sem aulas neste dia</p>
                    {noClassReason && (
                        <p className="text-sm text-muted-foreground">{noClassReason}</p>
                    )}
                </div>
            ) : (
                classes.map(({ item, start, end, status }, index) => (
                    <Fragment key={`${item.id}-${start}`}>
                        {gaps[index] !== undefined && (
                            <p className="px-3 text-xs text-muted-foreground">
                                Intervalo de {formatDuration(gaps[index])}
                            </p>
                        )}
                        <SubjectCard
                            title={item.subject.name}
                            code={item.subject.code}
                            start={start}
                            end={end}
                            room={item.room}
                            status={status}
                            color={colorOf(item.subject.code)}
                            onClick={() =>
                                preview
                                    ? navigate({
                                          to: '/turmas',
                                          search: { semester: item.semester }
                                      })
                                    : navigate({ to: '/turmas/$id', params: { id: item.id } })
                            }
                        />
                    </Fragment>
                ))
            )}
        </div>
    );
}

const STATUS_LABEL = { in_progress: 'Em andamento', next: 'Próxima' } as const;

function SubjectCard({
    title,
    code,
    start,
    end,
    room,
    status,
    color,
    onClick
}: {
    title: string;
    code: string;
    start: string;
    end: string;
    room?: string | null;
    status: ScheduledClass<AgendaItem>['status'];
    color: SubjectColor;
    onClick: () => void;
}) {
    const clock = useClock();
    const left = clock ? countdown(status, start, end, clock) : null;
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={`${title}, ${formatClock(start)} às ${formatClock(end)}`}
            className={cn(
                'flex w-full flex-col gap-2 rounded-2xl p-4 text-left transition-opacity outline-none hover:opacity-85 focus-visible:ring-3 focus-visible:ring-ring/50',
                color.soft,
                status === 'in_progress' && 'ring-2 ring-current/30',
                color.text
            )}
        >
            <div className="flex items-start justify-between gap-2">
                <h3 className="text-base leading-snug font-semibold uppercase">{title}</h3>
                {left && (
                    <span className="shrink-0 pt-0.5 text-xs font-semibold tabular-nums">
                        {left}
                    </span>
                )}
            </div>
            <p className="flex items-center gap-2 text-sm font-medium tabular-nums">
                {formatClock(start)}
                <ArrowRight className="size-4" aria-hidden="true" />
                {formatClock(end)}
                <span className="ml-auto text-xs font-medium tracking-wide opacity-70">{code}</span>
            </p>
            <p className="flex items-center gap-2 text-sm uppercase">
                <MapPin className="size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{room ?? 'Local não informado'}</span>
                {status !== 'normal' && (
                    <Badge
                        variant="secondary"
                        className={cn('shrink-0 bg-card/70 normal-case', color.text)}
                    >
                        {status === 'in_progress' && (
                            <span
                                className={cn('size-1.5 animate-pulse rounded-full', color.solid)}
                            />
                        )}
                        {STATUS_LABEL[status]}
                    </Badge>
                )}
            </p>
        </button>
    );
}

function EntryCard({ entry }: { entry: CalendarEntry }) {
    const kind = ENTRY_KINDS[entry.kind ?? 'evento'];
    return (
        <Link
            to="/calendario"
            search={{ date: entry.date }}
            className={cn(
                'flex items-center gap-3 rounded-2xl p-3 outline-none hover:opacity-85 focus-visible:ring-3 focus-visible:ring-ring/50',
                kind.soft
            )}
        >
            <span className={cn('h-8 w-1 shrink-0 rounded-full', kind.solid)} />
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold">{entry.title}</span>
                <span className="text-xs text-muted-foreground">
                    {[kind.label, entry.subject_code, entry.time && formatClock(entry.time)]
                        .filter(Boolean)
                        .join(' · ')}
                </span>
            </span>
        </Link>
    );
}
