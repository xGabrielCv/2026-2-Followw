import type { PlannedClass } from '#/lib/planned-schedule';

import { parseSchedule } from '#/lib/schedule';

export interface PlanMetrics {
    classes: number;
    hours: number;
    // dias de segunda a sexta com aula
    days: number;
    freeWeekdays: number;
    morning: number;
    afternoon: number;
    night: number;
    earliest: string | null;
    latest: string | null;
    // minutos de aula por semana
    minutes: number;
}

const minutesOf = (time: string) => {
    const [hours = 0, minutes = 0] = time.split(':').map(Number);
    return hours * 60 + minutes;
};

/** Números para comparar grades do mesmo semestre. */
export function planMetrics(items: PlannedClass[]): PlanMetrics {
    const times = items.flatMap((item) => parseSchedule(item.schedule));
    const weekdays = new Set(times.map((time) => time.weekday));
    const blocks = (from: number, to: number) =>
        times.filter((time) => minutesOf(time.start) >= from && minutesOf(time.start) < to).length;
    const starts = times.map((time) => time.start).toSorted();
    const ends = times.map((time) => time.end).toSorted();
    return {
        classes: items.length,
        hours: items.reduce((total, item) => total + (item.hours ?? 0), 0),
        days: weekdays.size,
        freeWeekdays: [1, 2, 3, 4, 5].filter((day) => !weekdays.has(day)).length,
        morning: blocks(0, 12 * 60),
        afternoon: blocks(12 * 60, 18 * 60),
        night: blocks(18 * 60, 24 * 60),
        earliest: starts[0] ?? null,
        latest: ends.at(-1) ?? null,
        minutes: times.reduce(
            (total, time) => total + minutesOf(time.end) - minutesOf(time.start),
            0
        )
    };
}

/** A média das notas dos docentes das turmas, pesando cada turma igual; sem nota, nula. */
export function averageRating(
    items: PlannedClass[],
    ratings: Record<string, { average: number }>
): number | null {
    const values = items.flatMap((item) => {
        const rated = item.professors
            .map(({ siape }) => (siape == null ? undefined : ratings[siape]?.average))
            .filter((value): value is number => value != null);
        return rated.length ? [rated.reduce((a, b) => a + b, 0) / rated.length] : [];
    });
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}
