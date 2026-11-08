import { CalendarClock } from 'lucide-react';

import type { Classroom } from '#/queries/classrooms';

import { eventDate, semesterProgress, upcomingEvents } from '#/calendar';
import { ListCard, Meter } from '#/components/ListCard';
import { formatDuration, weeklyMinutes } from '#/lib/schedule';

const dayMonth = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC'
});
const formatDay = (date: string) => dayMonth.format(new Date(`${date}T00:00:00Z`));

interface SemesterOverviewProps {
    date: string;
    // turmas do semestre atual; ausentes sem login
    classrooms?: Classroom[];
}

/** Andamento do semestre, carga semanal e o que vem pela frente no calendário. */
export function SemesterOverview({ date, classrooms }: SemesterOverviewProps) {
    const progress = semesterProgress(date);
    const events = upcomingEvents(date);
    const load = classrooms && weeklyMinutes(classrooms);
    if (!progress && !events.length) return null;

    return (
        <ListCard>
            {progress && (
                <Meter
                    label={`Semestre ${progress.semester}`}
                    value={progress.percent}
                    detail={
                        progress.week === 0
                            ? `Aulas de ${formatDay(progress.start)} a ${formatDay(progress.end)}`
                            : `Semana ${Math.min(progress.week, progress.weeks)} de ${progress.weeks} · ${progress.daysLeft} dias até o fim das aulas`
                    }
                />
            )}
            {classrooms && classrooms.length > 0 && (
                <dl className="flex flex-col gap-2 py-3 text-sm">
                    <div className="flex items-baseline justify-between gap-2">
                        <dt className="text-muted-foreground">Turmas no semestre</dt>
                        <dd className="font-medium tabular-nums">{classrooms.length}</dd>
                    </div>
                    {load ? (
                        <div className="flex items-baseline justify-between gap-2">
                            <dt className="text-muted-foreground">Aulas por semana</dt>
                            <dd className="font-medium tabular-nums">{formatDuration(load)}</dd>
                        </div>
                    ) : null}
                </dl>
            )}
            {events.length > 0 && (
                <div className="py-3">
                    <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                        <CalendarClock className="size-3.5 text-primary" aria-hidden="true" />
                        Próximas datas
                    </h3>
                    <ul className="flex flex-col gap-1.5">
                        {events.map((event) => {
                            const when = eventDate(event, date);
                            return (
                                <li
                                    key={`${event.name}-${when}`}
                                    className="flex items-baseline gap-2 text-xs"
                                >
                                    <span className="min-w-12 shrink-0 font-semibold whitespace-nowrap text-primary tabular-nums">
                                        {event.start_date < date ? 'até ' : ''}
                                        {formatDay(when)}
                                    </span>
                                    <span className="min-w-0 text-muted-foreground">
                                        {event.name}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </ListCard>
    );
}
