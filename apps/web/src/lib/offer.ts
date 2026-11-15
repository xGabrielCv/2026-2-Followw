import type { SemesterCalendar } from '#/calendar';

import {
    estimateRegularSemesterFromDate,
    getSemester,
    isEnrollmentPeriod,
    listSemesters
} from '#/calendar';

const REGULAR = /^\d{4}\.[12]$/;

/** `2026.2` -> `2027.1`; o de férias (`.4`) não conta. */
export function nextRegularSemester(semester: string) {
    const [year, term] = semester.split('.').map(Number);
    return term === 1 ? `${year}.2` : `${year + 1}.1`;
}

/** Último semestre regular já iniciado; nas férias, o que acabou de terminar; além da base, estima. */
export function currentRegularSemester(today: string, custom?: Record<string, SemesterCalendar>) {
    const regular = listSemesters(custom).filter(({ semester }) => REGULAR.test(semester));
    return (
        regular
            .filter(({ period }) => period.start <= today && today <= period.end)
            .map(({ semester }) => semester)
            .toSorted()
            .at(-1) ?? estimateRegularSemesterFromDate(today)
    );
}

/** Início da matrícula do semestre, pelo calendário acadêmico. */
export function enrollmentStart(semester: string, custom?: Record<string, SemesterCalendar>) {
    return getSemester(semester, custom)?.events.find((event) => event.category === 'enrollment')
        ?.start_date;
}

export function canAddToSchedule(
    semester: string,
    options: {
        today: string;
        allowCurrentOutsideEnrollment: boolean;
        custom?: Record<string, SemesterCalendar>;
    }
): boolean {
    const current = currentRegularSemester(options.today, options.custom);
    if (semester > current) return true;
    if (semester === current) {
        return (
            options.allowCurrentOutsideEnrollment ||
            isEnrollmentPeriod(semester, options.today, options.custom)
        );
    }
    return false;
}

export interface OfferChoice {
    semester: string;
    kind: 'current' | 'next';
    available: boolean;
}

/** O próximo e o atual, marcando quais têm oferta; prioriza o próximo se já publicado, senão o atual. */
export function offerChoices(
    available: readonly string[],
    today: string,
    custom?: Record<string, SemesterCalendar>
) {
    const current = currentRegularSemester(today, custom);
    const next = nextRegularSemester(current);
    const choices: OfferChoice[] = [
        { semester: next, kind: 'next', available: available.includes(next) },
        { semester: current, kind: 'current', available: available.includes(current) }
    ];
    const fallback = choices.find((choice) => choice.available)?.semester ?? current;
    return {
        choices,
        /** O escolhido, se tiver oferta; senão o próximo (se disponível), ou o atual, ou o mais recente. */
        resolve: (picked: string | null) =>
            picked && choices.some((choice) => choice.semester === picked && choice.available)
                ? picked
                : fallback
    };
}

/** Parâmetro da API: omitido quando é o padrão dela, o mais recente gravado. */
export const semesterParam = (semester: string | undefined, available: readonly string[]) =>
    semester && semester !== available[0] ? semester : undefined;
