import type { DayOverview } from '#/lib/schedule';

import { Card } from '#/components/ui/card';
import { formatDuration } from '#/lib/schedule';

interface DaySummaryProps {
    overview: DayOverview;
    isToday: boolean;
}

function closingStat({ start, end, nextIn, finished }: DayOverview, isToday: boolean) {
    if (!isToday) return { label: 'Horário', value: `${start}–${end}` };
    if (finished) return { label: 'Aulas', value: 'Encerradas' };
    if (nextIn !== undefined) return { label: 'Próxima em', value: formatDuration(nextIn) };
    return { label: 'Termina às', value: end };
}

/** Três números do dia: quantas aulas, quanto tempo em sala e o que vem a seguir. */
export function DaySummary({ overview, isToday }: DaySummaryProps) {
    if (!overview.count) return null;
    const stats = [
        { label: overview.count === 1 ? 'Aula' : 'Aulas', value: String(overview.count) },
        { label: 'Em sala', value: formatDuration(overview.minutes) },
        closingStat(overview, isToday)
    ];

    return (
        <section aria-label="Resumo do dia">
            <Card size="sm" className="gap-0 py-0">
                <dl className="grid grid-cols-3 divide-x divide-border">
                    {stats.map((stat) => (
                        <div key={stat.label} className="flex min-w-0 flex-col px-3 py-3">
                            <dt className="truncate text-xs font-medium text-muted-foreground">
                                {stat.label}
                            </dt>
                            <dd className="mt-1 truncate text-xl font-semibold tracking-tight text-primary tabular-nums">
                                {stat.value}
                            </dd>
                        </div>
                    ))}
                </dl>
            </Card>
        </section>
    );
}
