import calendarData from 'academic-calendar';

export type CalendarEventCategory =
    | 'academic'
    | 'administrative'
    | 'enrollment'
    | 'holiday'
    | 'optional_holiday'
    | 'university_week'
    | 'other';

export interface CalendarEvent {
    id?: string | null;
    name: string;
    start_date: string;
    end_date: string;
    category: string;
}

export interface CalendarPeriod {
    start: string;
    end: string;
}

export interface ClassesPeriod extends CalendarPeriod {
    instructional_days: number;
}

export interface SemesterCalendar {
    semester: string;
    name: string;
    period: CalendarPeriod;
    classes: ClassesPeriod;
    events: CalendarEvent[];
}

export interface AcademicCalendar {
    semesters: Record<string, SemesterCalendar>;
}

export const academicCalendar: AcademicCalendar = calendarData;

let customSemesters: Record<string, SemesterCalendar> = {};

export function setCustomSemesters(next: Record<string, SemesterCalendar> = {}) {
    customSemesters = next;
}

function semesterMap(custom: Record<string, SemesterCalendar> = customSemesters) {
    return Object.keys(custom).length
        ? { ...academicCalendar.semesters, ...custom }
        : academicCalendar.semesters;
}

/** Estimativa determinística do semestre regular quando ainda não há calendário oficial importado. */
export function estimateRegularSemesterFromDate(today: string): string {
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    if (month <= 2) return `${year - 1}.2`;
    if (month <= 7) return `${year}.1`;
    return `${year}.2`;
}

export function estimateRegularSemester(date: Date = new Date()): string {
    return estimateRegularSemesterFromDate(
        date.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    );
}

const NO_CLASS_EVENT_CATEGORIES: ReadonlySet<string> = new Set<CalendarEventCategory>([
    'holiday',
    'optional_holiday',
    'university_week'
]);

export function getNoClassEvents(date: string): CalendarEvent[] {
    return listSemesters().flatMap(({ period, events }) =>
        period.start <= date && date <= period.end
            ? events.filter(
                  (event) =>
                      NO_CLASS_EVENT_CATEGORIES.has(event.category) &&
                      event.start_date <= date &&
                      date <= event.end_date
              )
            : []
    );
}

export function getNoClassReason(date: string): string | undefined {
    const event = getNoClassEvents(date)[0];
    if (event) return event.name;

    const semester = listSemesters().find(
        ({ period }) => period.start <= date && date <= period.end
    );
    if (semester && (date < semester.classes.start || date > semester.classes.end)) {
        return 'Fora do período de aulas';
    }
    return undefined;
}

export function getSemester(
    semester: string,
    custom?: Record<string, SemesterCalendar>
): SemesterCalendar | undefined {
    return semesterMap(custom)[semester];
}

export function listSemesters(custom?: Record<string, SemesterCalendar>): SemesterCalendar[] {
    return Object.values(semesterMap(custom));
}

export function isEnrollmentPeriod(
    semester: string,
    date: string,
    custom?: Record<string, SemesterCalendar>
): boolean {
    const entry = getSemester(semester, custom);
    if (!entry) return false;
    return entry.events.some(
        (event) =>
            event.category === 'enrollment' && event.start_date <= date && date <= event.end_date
    );
}

export function getCurrentSemester(
    date: Date = new Date(),
    custom?: Record<string, SemesterCalendar>
): SemesterCalendar | undefined {
    const today = date.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const semesters = listSemesters(custom);

    // Retorna o semestre atual ou o futuro mais próximo; além da base conhecida, estima automaticamente
    const found =
        semesters.find(({ period }) => period.start <= today && today <= period.end) ??
        semesters
            .filter(({ period }) => period.start > today)
            .reduce<SemesterCalendar | undefined>(
                (next, s) => (!next || s.period.start < next.period.start ? s : next),
                undefined
            );
    return found;
}

const DAY_MS = 86_400_000;
const daysBetween = (start: string, end: string) =>
    Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS);

export interface SemesterProgress {
    semester: string;
    start: string;
    end: string;
    percent: number;
    week: number;
    weeks: number;
    daysLeft: number;
}

/** Quanto do período de aulas do semestre de `date` já passou. */
export function semesterProgress(
    date: string,
    custom?: Record<string, SemesterCalendar>
): SemesterProgress | undefined {
    const semesters = listSemesters(custom);
    const current = semesters.find(({ period }) => period.start <= date && date <= period.end);
    if (!current) return undefined;
    const { start, end } = current.classes;
    const total = daysBetween(start, end) + 1;
    const elapsed = Math.min(total, Math.max(0, daysBetween(start, date) + 1));
    return {
        semester: current.semester,
        start,
        end,
        percent: Math.round((elapsed / total) * 100),
        week: Math.ceil(elapsed / 7),
        weeks: Math.ceil(total / 7),
        daysLeft: total - elapsed
    };
}

/** Data em que o evento importa: o início ou, se já começou, o prazo final. */
export const eventDate = (event: CalendarEvent, date: string) =>
    event.start_date >= date ? event.start_date : event.end_date;

/** Próximos eventos do calendário a partir de `date`; os em andamento contam pelo prazo. */
export function upcomingEvents(date: string, limit = 3): CalendarEvent[] {
    return listSemesters()
        .flatMap(({ events }) => events)
        .filter((event) => event.end_date >= date)
        .toSorted((a, b) => eventDate(a, date).localeCompare(eventDate(b, date)))
        .slice(0, limit);
}
