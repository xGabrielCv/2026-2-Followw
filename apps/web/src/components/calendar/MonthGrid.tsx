import { ChevronLeft, ChevronRight } from 'lucide-react';

import type { CalendarEvent } from '#/calendar';
import type { CalendarEntry } from '#/queries/events';

import { Button } from '#/components/ui/button';
import { ENTRY_KINDS, isNoClass, monthLabel, monthWeeks } from '#/lib/agenda';
import { cn } from '#/lib/shadcn';

const WEEKDAYS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
const MAX_CHIPS = 3;

export interface DayMarks {
    academic: CalendarEvent[];
    entries: CalendarEntry[];
}

interface MonthGridProps {
    month: string;
    selected: string;
    today: string;
    marks: (date: string) => DayMarks;
    onSelect: (date: string) => void;
    onMonth: (step: number) => void;
}

/** O mês inteiro, de domingo a sábado, com os lançamentos e as datas da UnB; as aulas ficam no dia. */
export function MonthGrid({ month, selected, today, marks, onSelect, onMonth }: MonthGridProps) {
    return (
        <section aria-label={monthLabel(month)} className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
                <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => onMonth(-1)}
                    aria-label="Mês anterior"
                >
                    <ChevronLeft />
                </Button>
                <h2 className="text-base font-semibold" aria-live="polite">
                    {monthLabel(month)}
                </h2>
                <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => onMonth(1)}
                    aria-label="Próximo mês"
                >
                    <ChevronRight />
                </Button>
            </div>
            <div className="overflow-hidden rounded-2xl border bg-card">
                <div className="grid grid-cols-7 border-b">
                    {WEEKDAYS.map((weekday) => (
                        <span
                            key={weekday}
                            className="px-1 py-2 text-center text-xs font-semibold text-muted-foreground desk:px-2 desk:text-left"
                        >
                            {weekday}
                        </span>
                    ))}
                </div>
                {monthWeeks(month).map((week) => (
                    <div key={week[0]} className="grid grid-cols-7 border-b last:border-b-0">
                        {week.map((date) => (
                            <DayCell
                                key={date}
                                date={date}
                                outside={date.slice(0, 7) !== month}
                                selected={date === selected}
                                today={date === today}
                                marks={marks(date)}
                                onSelect={onSelect}
                            />
                        ))}
                    </div>
                ))}
            </div>
            <Legend />
        </section>
    );
}

function DayCell({
    date,
    outside,
    selected,
    today,
    marks,
    onSelect
}: {
    date: string;
    outside: boolean;
    selected: boolean;
    today: boolean;
    marks: DayMarks;
    onSelect: (date: string) => void;
}) {
    const holiday = marks.academic.find(isNoClass);
    const chips = [
        ...marks.entries.map((entry) => ({
            key: entry.id,
            label: entry.title,
            className: cn(
                ENTRY_KINDS[entry.kind ?? 'evento'].soft,
                ENTRY_KINDS[entry.kind ?? 'evento'].text
            )
        })),
        ...marks.academic.map((event) => ({
            key: `${event.name}-${event.start_date}`,
            label: event.name,
            className: isNoClass(event)
                ? 'bg-destructive/10 text-destructive'
                : 'bg-muted text-muted-foreground'
        }))
    ];
    const hidden = chips.length - MAX_CHIPS;
    const summary = [marks.entries.length && `${marks.entries.length} lançamentos`, holiday?.name]
        .filter(Boolean)
        .join(', ');

    return (
        <button
            type="button"
            onClick={() => onSelect(date)}
            aria-pressed={selected}
            aria-label={`${Number(date.slice(8))}${summary ? `: ${summary}` : ''}`}
            className={cn(
                'flex min-h-20 min-w-0 flex-col gap-1 border-r p-1 text-left outline-none last:border-r-0 hover:bg-muted/60 focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-ring/50 desk:min-h-28 desk:p-2',
                outside && 'bg-muted/30 text-muted-foreground',
                selected && 'bg-primary/10 ring-2 ring-primary ring-inset hover:bg-primary/10'
            )}
        >
            <span
                className={cn(
                    'flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                    today && 'bg-primary text-primary-foreground',
                    !today && holiday && 'text-destructive'
                )}
            >
                {Number(date.slice(8))}
            </span>
            {chips.slice(0, MAX_CHIPS).map((chip) => (
                <span
                    key={chip.key}
                    className={cn('truncate rounded px-1 text-xs leading-5', chip.className)}
                >
                    {chip.label}
                </span>
            ))}
            {hidden > 0 && <span className="px-1 text-xs text-muted-foreground">+{hidden}</span>}
        </button>
    );
}

function Legend() {
    return (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
            {(['prova', 'trabalho', 'evento', 'lembrete'] as const).map((kind) => (
                <li key={kind} className="flex items-center gap-1.5">
                    <span className={cn('size-2 rounded-full', ENTRY_KINDS[kind].solid)} />
                    {ENTRY_KINDS[kind].label}
                </li>
            ))}
            <li className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-destructive/40" />
                Feriado ou sem aula
            </li>
            <li className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-muted-foreground/40" />
                Calendário UnB
            </li>
        </ul>
    );
}
