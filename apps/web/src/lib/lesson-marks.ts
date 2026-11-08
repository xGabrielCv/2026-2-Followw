import type { ClassroomFrequency, Lesson } from '#/queries/classrooms';

import { accountStore } from '#/lib/local-storage';

// Presença, falta ou aula cancelada que o aluno marca enquanto o SIGAA não registra a chamada.
// Fica só neste navegador: o servidor devolve a chamada do SIGAA e nunca vê as marcações.
export type LessonMarkStatus = 'presente' | 'falta' | 'cancelada';
// turma -> aula -> marcação
export type LessonMarks = Record<string, Record<string, LessonMarkStatus>>;

const EMPTY: LessonMarks = {};
const STATUSES = new Set<string>(['presente', 'falta', 'cancelada']);
// limite generoso para o storage não crescer sem fim (um semestre cheio tem ~300 aulas)
const MAX_PER_CLASSROOM = 400;

export const marksStore = (registration: string) =>
    accountStore<LessonMarks>(`marks:${registration}`, EMPTY);

export function validMarks(value: unknown): value is LessonMarks {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    return Object.values(value).every(
        (lessons) =>
            typeof lessons === 'object' &&
            lessons !== null &&
            !Array.isArray(lessons) &&
            Object.keys(lessons).length <= MAX_PER_CLASSROOM &&
            Object.values(lessons).every(
                (status) => typeof status === 'string' && STATUSES.has(status)
            )
    );
}

/** Grava (ou com `null` apaga) a marcação das aulas de uma turma. */
export function setMarks(
    marks: LessonMarks,
    classroomId: string,
    lessonIds: string[],
    status: LessonMarkStatus | null
): LessonMarks {
    const lessons = { ...marks[classroomId] };
    for (const id of lessonIds) {
        if (status) lessons[id] = status;
        else delete lessons[id];
    }
    const next = { ...marks };
    if (Object.keys(lessons).length) next[classroomId] = lessons;
    else delete next[classroomId];
    return next;
}

// Início e fim dos horários do dia, como a API: horários seguidos são uma aula só.
const SLOTS: Array<[string, string]> = [
    ['08:00', '08:55'],
    ['08:55', '09:50'],
    ['10:00', '10:55'],
    ['10:55', '11:50'],
    ['12:00', '12:55'],
    ['12:55', '13:50'],
    ['14:00', '14:55'],
    ['14:55', '15:50'],
    ['16:00', '16:55'],
    ['16:55', '17:50'],
    ['18:00', '18:55'],
    ['19:00', '19:50'],
    ['19:50', '20:40'],
    ['20:50', '21:40'],
    ['21:40', '22:30']
];

const hhmm = (value: string) => value.slice(0, 5);

/** Horas-aula entre o início e o fim; uma, sem horário. */
export function lessonHours(start: string | null, end: string | null): number {
    if (!start || !end) return 1;
    const from = hhmm(start);
    const to = hhmm(end);
    return SLOTS.filter(([s, e]) => from <= s && e <= to).length || 1;
}

const counts = (lesson: Lesson) => lesson.status === 'presente' || lesson.status === 'falta';

/** Os totais como a API calcula, em horas-aula; sem presença nem falta, `null`. */
export function frequencyTotals(
    lessons: Lesson[],
    maxAbsences: number | null
): ClassroomFrequency['totals'] {
    let presences = 0;
    let absences = 0;
    let total = 0;
    for (const lesson of lessons) {
        const length = Math.max(
            lessonHours(lesson.start_time, lesson.end_time),
            lesson.absences ?? 0
        );
        total += length;
        absences += lesson.absences ?? 0;
        if (counts(lesson)) presences += length - (lesson.absences ?? 0);
    }
    const estimated = lessons.some((lesson) => lesson.marked && counts(lesson));
    const recorded = lessons.some((lesson) => !lesson.marked && counts(lesson));
    if (!estimated && !recorded) return null;
    return {
        presences,
        absences,
        percentage: Math.round(((total - absences) * 1000) / total) / 10,
        max_absences: maxAbsences,
        estimated
    };
}

const newestFirst = (a: Lesson, b: Lesson) =>
    b.occurred_on.localeCompare(a.occurred_on) ||
    Number(b.start_time === null) - Number(a.start_time === null) ||
    (b.start_time ?? '').localeCompare(a.start_time ?? '');

/**
 * A frequência do SIGAA com as marcações do aluno: a marcação só vale onde o SIGAA não
 * registrou a chamada; numa aula futura, só o cancelamento.
 */
export function withMarks(
    data: ClassroomFrequency,
    marks: Record<string, LessonMarkStatus> = {}
): ClassroomFrequency {
    const applies = (lesson: Lesson) =>
        marks[lesson.id] !== undefined && lesson.status === 'nao_registrada';
    const cancelled = data.upcoming.filter((lesson) => marks[lesson.id] === 'cancelada');
    // sem marcação que valha, os totais do SIGAA (calculados pela API) ficam como estão
    if (!cancelled.length && !data.lessons.some(applies)) return data;
    const mark = (lesson: Lesson): Lesson => {
        const status = marks[lesson.id];
        if (!status || !applies(lesson)) return lesson;
        return {
            ...lesson,
            status,
            marked: true,
            absences: status === 'falta' ? lessonHours(lesson.start_time, lesson.end_time) : 0
        };
    };
    const lessons = [...data.lessons, ...cancelled].map(mark).toSorted(newestFirst);
    const maxAbsences = data.max_absences ?? data.totals?.max_absences ?? null;
    return {
        ...data,
        lessons,
        upcoming: data.upcoming.filter((lesson) => marks[lesson.id] !== 'cancelada'),
        totals: frequencyTotals(lessons, maxAbsences)
    };
}

export type AbsenceRisk = {
    level: 'warning' | 'danger';
    absences: number;
    max: number;
    left: number;
};

/**
 * A UnB reprova com menos de 75% de presença: o limite são 25% da carga em faltas. Avisa
 * quando falta pouco (um quarto do limite, ou duas aulas de duas horas) e quando passou.
 */
export function absenceRisk(totals: ClassroomFrequency['totals']): AbsenceRisk | null {
    if (!totals || totals.max_absences === null || totals.max_absences <= 0) return null;
    const max = totals.max_absences;
    const left = max - totals.absences;
    if (left < 0) return { level: 'danger', absences: totals.absences, max, left };
    if (left <= Math.max(4, Math.ceil(max / 4)))
        return { level: left === 0 ? 'danger' : 'warning', absences: totals.absences, max, left };
    return null;
}
