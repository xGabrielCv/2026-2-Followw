import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import type { Lesson } from '#/queries/classrooms';

import { getNoClassReason } from '#/calendar';
import { Button } from '#/components/ui/button';
import { monthLabel, monthWeeks } from '#/lib/agenda';
import { nowInBrasilia } from '#/lib/schedule';
import { cn } from '#/lib/shadcn';

const STATUS = {
    presente: 'Presença',
    falta: 'Falta',
    nao_registrada: 'Não registrada',
    cancelada: 'Cancelada'
};
const DOT = {
    presente: 'bg-primary',
    falta: 'bg-destructive',
    nao_registrada: 'bg-muted-foreground',
    cancelada: 'bg-muted-foreground/40'
};

export function lessonsByDay(lessons: Lesson[]) {
    const days = new Map<string, Lesson[]>();
    for (const lesson of lessons.toSorted(
        (a, b) =>
            a.occurred_on.localeCompare(b.occurred_on) ||
            (a.start_time ?? '').localeCompare(b.start_time ?? '')
    )) {
        const date = lesson.occurred_on.slice(0, 10);
        const values = days.get(date) ?? [];
        values.push(lesson);
        days.set(date, values);
    }
    return days;
}

export function LessonCalendar({
    lessons,
    selected,
    onSelect
}: {
    lessons: Lesson[];
    selected: string | null;
    onSelect: (date: string | null) => void;
}) {
    const today = nowInBrasilia().date;
    const days = lessonsByDay(lessons);
    const dates = [...days.keys()];
    const first = dates[0]?.slice(0, 7) ?? today.slice(0, 7);
    const last = dates.at(-1)?.slice(0, 7) ?? first;
    const [month, setMonth] = useState(() =>
        today.slice(0, 7) < first ? first : today.slice(0, 7) > last ? last : today.slice(0, 7)
    );
    const move = (step: number) => {
        const date = new Date(`${month}-01T00:00:00Z`);
        date.setUTCMonth(date.getUTCMonth() + step);
        setMonth(date.toISOString().slice(0, 7));
    };
    return (
        <section aria-label="Calendário de frequência" className="rounded-xl border bg-card p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Mês anterior de frequência"
                    disabled={month <= first}
                    onClick={() => move(-1)}
                >
                    <ChevronLeft />
                </Button>
                <h3 aria-live="polite" className="text-sm font-semibold">
                    {monthLabel(month)}
                </h3>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Próximo mês de frequência"
                    disabled={month >= last}
                    onClick={() => move(1)}
                >
                    <ChevronRight />
                </Button>
            </div>
            <div className="grid grid-cols-7 gap-1">
                {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((day) => (
                    <span key={day} className="text-center text-xs text-muted-foreground">
                        {day[0]}
                    </span>
                ))}
                {monthWeeks(month)
                    .flat()
                    .map((date) => {
                        const entries = days.get(date) ?? [];
                        const holiday = getNoClassReason(date);
                        const label = `${date.split('-').toReversed().join('/')}: ${entries.map((item) => STATUS[item.status]).join(', ') || 'Sem aula'}${holiday ? `, ${holiday}` : ''}`;
                        return (
                            <button
                                key={date}
                                type="button"
                                title={label}
                                aria-label={label}
                                aria-pressed={date === selected}
                                disabled={!entries.length || date.slice(0, 7) !== month}
                                onClick={() => onSelect(selected === date ? null : date)}
                                className={cn(
                                    'flex min-h-10 flex-col items-center justify-center gap-1 rounded-lg text-xs tabular-nums focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40',
                                    date === today && 'bg-muted font-semibold',
                                    date === selected && 'bg-primary/10 ring-1 ring-primary',
                                    holiday && 'text-destructive',
                                    entries.length > 0 &&
                                        entries.every((item) => item.status === 'cancelada') &&
                                        'line-through'
                                )}
                            >
                                {Number(date.slice(8))}
                                <span aria-hidden="true" className="flex gap-0.5">
                                    {entries.map((item) => (
                                        <span
                                            key={item.id}
                                            className={cn('size-1 rounded-full', DOT[item.status])}
                                        />
                                    ))}
                                </span>
                            </button>
                        );
                    })}
            </div>
            <ul className="mt-3 flex flex-wrap justify-center gap-3 text-xs text-muted-foreground">
                {(['presente', 'falta', 'nao_registrada'] as const).map((status) => (
                    <li key={status} className="flex items-center gap-1">
                        <span className={cn('size-1.5 rounded-full', DOT[status])} />
                        {STATUS[status]}
                    </li>
                ))}
            </ul>
            {selected && (
                <Button variant="ghost" size="sm" className="mt-2" onClick={() => onSelect(null)}>
                    Mostrar todas as aulas
                </Button>
            )}
        </section>
    );
}
