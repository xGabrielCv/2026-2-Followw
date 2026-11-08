import type { CalendarEvent } from '#/calendar';
import type { ScheduledClass } from '#/lib/schedule';
import type { CalendarEntry, CalendarEntryKind } from '#/queries/events';

import { getNoClassReason, listSemesters } from '#/calendar';
import { addDays, classesOn } from '#/lib/schedule';

/** Uma cor do tema por matéria, a mesma no início e no calendário. */
export const SUBJECT_COLORS = [
    { text: 'text-flow-1', soft: 'bg-flow-1/10', solid: 'bg-flow-1' },
    { text: 'text-flow-2', soft: 'bg-flow-2/10', solid: 'bg-flow-2' },
    { text: 'text-flow-3', soft: 'bg-flow-3/10', solid: 'bg-flow-3' },
    { text: 'text-flow-4', soft: 'bg-flow-4/10', solid: 'bg-flow-4' },
    { text: 'text-flow-5', soft: 'bg-flow-5/10', solid: 'bg-flow-5' },
    { text: 'text-flow-6', soft: 'bg-flow-6/10', solid: 'bg-flow-6' },
    { text: 'text-flow-7', soft: 'bg-flow-7/10', solid: 'bg-flow-7' }
] as const;

export type SubjectColor = (typeof SUBJECT_COLORS)[number];

/** Cores pela ordem dos códigos (não repetem até a 8ª), salvo as que o aluno escolheu. */
export function subjectPalette(
    codes: Iterable<string>,
    chosen: Record<string, number> = {}
): (code: string) => SubjectColor {
    const sorted = [...new Set(codes)].toSorted();
    return (code) =>
        SUBJECT_COLORS[(chosen[code] ?? automaticIndex(sorted, code)) % SUBJECT_COLORS.length];
}

/** A cor automática da matéria entre as do aluno (`codes`). */
export const automaticColorIndex = (codes: Iterable<string>, code: string) =>
    automaticIndex([...new Set(codes)].toSorted(), code);

function automaticIndex(sorted: string[], code: string) {
    const index = sorted.indexOf(code);
    return (index === -1 ? hash(code) : index) % SUBJECT_COLORS.length;
}

/** O que a agenda precisa de uma aula: turma do SIGAA ou turma planejada na busca. */
export interface AgendaItem {
    id: string;
    subject: { code: string; name: string };
    room?: string | null;
    schedule?: string | null;
    semester: string;
}

/** Semestre cujo período de aulas inclui `date`. */
export const classesSemesterOf = (date: string) =>
    listSemesters().find(({ classes }) => classes.start <= date && date <= classes.end)?.semester;

/**
 * As aulas de `date`, geradas das turmas daquele semestre; sem turmas do SIGAA nele (o
 * próximo, antes da matrícula), vale a grade planejada na busca, marcada como prévia.
 */
export function agendaFor(
    date: string,
    classrooms: AgendaItem[],
    planned: AgendaItem[] = [],
    time?: string
): { classes: ScheduledClass<AgendaItem>[]; preview: boolean } {
    const semester = classesSemesterOf(date);
    if (!semester || getNoClassReason(date)) return { classes: [], preview: false };
    const real = classrooms.filter((item) => item.semester === semester);
    const draft = planned.filter((item) => item.semester === semester);
    const preview = real.length === 0 && draft.length > 0;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    return { classes: classesOn(preview ? draft : real, weekday, time), preview };
}

function hash(text: string) {
    let value = 0;
    for (const char of text) value = (value * 31 + char.charCodeAt(0)) >>> 0;
    return value;
}

export const ENTRY_KINDS: Record<
    CalendarEntryKind,
    { label: string; text: string; soft: string; solid: string }
> = {
    prova: {
        label: 'Prova',
        text: 'text-destructive',
        soft: 'bg-destructive/10',
        solid: 'bg-destructive'
    },
    trabalho: {
        label: 'Trabalho',
        text: 'text-warning',
        soft: 'bg-warning/10',
        solid: 'bg-warning'
    },
    evento: { label: 'Evento', text: 'text-info', soft: 'bg-info/10', solid: 'bg-info' },
    lembrete: {
        label: 'Lembrete',
        text: 'text-primary',
        soft: 'bg-primary/10',
        solid: 'bg-primary'
    }
};

export const ENTRY_KIND_ORDER: CalendarEntryKind[] = ['prova', 'trabalho', 'evento', 'lembrete'];

export const REMINDER_OPTIONS = [
    { value: null, label: 'Sem lembrete' },
    { value: 0, label: 'No dia' },
    { value: 1, label: '1 dia antes' },
    { value: 3, label: '3 dias antes' },
    { value: 7, label: '1 semana antes' },
    { value: 14, label: '2 semanas antes' }
] as const;

/** `08:00` ou `08:00:00` -> `8:00`. */
export const formatClock = (time: string) => time.slice(0, 5).replace(/^0/, '');

export const entriesOn = (entries: CalendarEntry[], date: string) =>
    entries
        .filter((entry) => entry.date === date)
        .toSorted((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));

/** Lançamentos cujo lembrete já começou e que ainda não passaram, do mais próximo ao mais distante. */
export function dueReminders(entries: CalendarEntry[], today: string): CalendarEntry[] {
    return entries
        .filter(
            (entry) =>
                entry.remind_days != null &&
                entry.date >= today &&
                addDays(entry.date, -entry.remind_days) <= today
        )
        .toSorted(
            (a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '')
        );
}

const DAY_MS = 86_400_000;
export const daysUntil = (today: string, date: string) =>
    Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);

/** `0` -> hoje, `1` -> amanhã, `n` -> em n dias. */
export function relativeDays(days: number) {
    if (days === 0) return 'Hoje';
    if (days === 1) return 'Amanhã';
    return `Em ${days} dias`;
}

// Eventos longos (como o período de matrícula) só marcam o início e o fim no mês.
const LONG_EVENT_DAYS = 7;

/** Eventos do calendário da UnB que aparecem em `date`, os sem aula primeiro. */
export function academicEventsOn(date: string): CalendarEvent[] {
    const seen = new Set<string>();
    return listSemesters()
        .flatMap(({ events }) => events)
        .filter((event) => {
            if (event.start_date > date || date > event.end_date) return false;
            const long = daysUntil(event.start_date, event.end_date) >= LONG_EVENT_DAYS;
            if (long && date !== event.start_date && date !== event.end_date) return false;
            const key = `${event.name}|${event.start_date}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .toSorted((a, b) => Number(!isNoClass(a)) - Number(!isNoClass(b)));
}

export const isNoClass = (event: CalendarEvent) =>
    event.category === 'holiday' ||
    event.category === 'optional_holiday' ||
    event.category === 'university_week';

/** As semanas (domingo a sábado) que cobrem o mês `AAAA-MM`, com os dias de fora no começo e no fim. */
export function monthWeeks(month: string): string[][] {
    const first = `${month}-01`;
    const start = addDays(first, -new Date(`${first}T00:00:00Z`).getUTCDay());
    const weeks: string[][] = [];
    let day = start;
    do {
        weeks.push(Array.from({ length: 7 }, (_, offset) => addDays(day, offset)));
        day = addDays(day, 7);
    } while (day.slice(0, 7) === month);
    return weeks;
}

/** `2026-11` + 1 -> `2026-12`. */
export function addMonths(month: string, count: number) {
    const date = new Date(`${month}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + count);
    return date.toISOString().slice(0, 7);
}

const monthFormat = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
});
const dayFormat = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC'
});

/** `2026-11` -> `Novembro de 2026`. */
export function monthLabel(month: string) {
    const label = monthFormat.format(new Date(`${month}-01T00:00:00Z`));
    return label.charAt(0).toUpperCase() + label.slice(1);
}

/** `2026-11-09` -> `segunda-feira, 9 de novembro`. */
export const dayLabel = (date: string) => dayFormat.format(new Date(`${date}T00:00:00Z`));
