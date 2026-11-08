import { Link } from '@tanstack/react-router';
import { ArrowRight, CalendarDays, MapPin, Plus } from 'lucide-react';

import type { CalendarEvent } from '#/calendar';
import type { AgendaItem, SubjectColor } from '#/lib/agenda';
import type { ScheduledClass } from '#/lib/schedule';
import type { CalendarEntry } from '#/queries/events';

import { ListCard } from '#/components/ListCard';
import { SectionHeader } from '#/components/SectionHeader';
import { Button } from '#/components/ui/button';
import { ENTRY_KINDS, dayLabel, formatClock, isNoClass } from '#/lib/agenda';
import { cn } from '#/lib/shadcn';

const CATEGORY_LABELS: Record<string, string> = {
    holiday: 'Feriado',
    optional_holiday: 'Ponto facultativo',
    university_week: 'Semana Universitária',
    enrollment: 'Matrícula',
    academic: 'Acadêmico',
    administrative: 'Administrativo'
};

interface DayDetailsProps {
    date: string;
    loggedIn: boolean;
    academic: CalendarEvent[];
    classes: ScheduledClass<AgendaItem>[];
    // prévia da grade planejada, antes de haver turmas do semestre no SIGAA
    preview?: boolean;
    entries: CalendarEntry[];
    colorOf: (code: string) => SubjectColor;
    onAdd: () => void;
    onEdit: (entry: CalendarEntry) => void;
}

/** Tudo do dia escolhido: datas da UnB, aulas e lançamentos, com o botão de lançar. */
export function DayDetails({
    date,
    loggedIn,
    academic,
    classes,
    preview = false,
    entries,
    colorOf,
    onAdd,
    onEdit
}: DayDetailsProps) {
    const empty = academic.length === 0 && classes.length === 0 && entries.length === 0;
    return (
        <section aria-label="Dia escolhido" className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-2">
                <h2 className="min-w-0 text-base font-semibold first-letter:uppercase">
                    {dayLabel(date)}
                </h2>
                {loggedIn && (
                    <Button size="sm" onClick={onAdd}>
                        <Plus />
                        Lançar neste dia
                    </Button>
                )}
            </div>

            {empty && (
                <p className="rounded-2xl bg-card p-4 text-sm text-muted-foreground">
                    Nada marcado para este dia.
                    {!loggedIn &&
                        ' Entre com o SIGAA para ver suas aulas e lançar provas e eventos.'}
                </p>
            )}

            {entries.length > 0 && (
                <div>
                    <SectionHeader title="Lançamentos" />
                    <ListCard>
                        {entries.map((entry) => {
                            const kind = ENTRY_KINDS[entry.kind ?? 'evento'];
                            return (
                                <button
                                    key={entry.id}
                                    type="button"
                                    onClick={() => onEdit(entry)}
                                    className="flex w-full items-start gap-3 py-2.5 text-left hover:opacity-80"
                                >
                                    <span
                                        className={cn(
                                            'mt-1 h-8 w-1 shrink-0 rounded-full',
                                            kind.solid
                                        )}
                                    />
                                    <span className="flex min-w-0 flex-1 flex-col">
                                        <span className="text-sm font-semibold">{entry.title}</span>
                                        <span className="text-xs text-muted-foreground">
                                            {[
                                                kind.label,
                                                entry.subject_code,
                                                entry.time && formatClock(entry.time),
                                                entry.remind_days != null &&
                                                    (entry.remind_days === 0
                                                        ? 'lembrete no dia'
                                                        : `lembrete ${entry.remind_days} ${entry.remind_days === 1 ? 'dia' : 'dias'} antes`)
                                            ]
                                                .filter(Boolean)
                                                .join(' · ')}
                                        </span>
                                        {entry.notes && (
                                            <span className="mt-1 text-xs whitespace-pre-line">
                                                {entry.notes}
                                            </span>
                                        )}
                                    </span>
                                </button>
                            );
                        })}
                    </ListCard>
                </div>
            )}

            {classes.length > 0 && (
                <div>
                    <SectionHeader title={preview ? 'Aulas (prévia da grade)' : 'Aulas'} />
                    <div className="flex flex-col gap-2">
                        {classes.map(({ item, start, end }) => {
                            const color = colorOf(item.subject.code);
                            return (
                                <Link
                                    key={`${item.id}-${start}`}
                                    {...(preview
                                        ? {
                                              to: '/turmas' as const,
                                              search: { semester: item.semester }
                                          }
                                        : { to: '/turmas/$id' as const, params: { id: item.id } })}
                                    className={cn(
                                        'flex flex-col gap-1 rounded-2xl p-3 hover:opacity-85',
                                        color.soft,
                                        color.text
                                    )}
                                >
                                    <span className="text-sm font-semibold uppercase">
                                        {item.subject.name}
                                    </span>
                                    <span className="flex items-center gap-2 text-xs font-medium tabular-nums">
                                        {formatClock(start)}
                                        <ArrowRight className="size-3" aria-hidden="true" />
                                        {formatClock(end)}
                                        <MapPin className="ml-2 size-3" aria-hidden="true" />
                                        <span className="truncate uppercase">
                                            {item.room ?? 'Local não informado'}
                                        </span>
                                    </span>
                                </Link>
                            );
                        })}
                    </div>
                </div>
            )}

            {academic.length > 0 && (
                <div>
                    <SectionHeader title="Calendário da UnB" />
                    <ListCard>
                        {academic.map((event) => (
                            <div
                                key={`${event.name}-${event.start_date}`}
                                className="flex items-start gap-3 py-2.5"
                            >
                                <CalendarDays
                                    className={cn(
                                        'mt-0.5 size-4 shrink-0',
                                        isNoClass(event)
                                            ? 'text-destructive'
                                            : 'text-muted-foreground'
                                    )}
                                    aria-hidden="true"
                                />
                                <span className="flex min-w-0 flex-col">
                                    <span className="text-sm font-medium">{event.name}</span>
                                    <span className="text-xs text-muted-foreground">
                                        {[
                                            CATEGORY_LABELS[event.category],
                                            event.start_date !== event.end_date &&
                                                `${formatDay(event.start_date)} a ${formatDay(event.end_date)}`
                                        ]
                                            .filter(Boolean)
                                            .join(' · ')}
                                    </span>
                                </span>
                            </div>
                        ))}
                    </ListCard>
                </div>
            )}
        </section>
    );
}

const formatDay = (date: string) => `${date.slice(8)}/${date.slice(5, 7)}`;
