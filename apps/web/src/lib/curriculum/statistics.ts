import type { AcademicState, CurriculumModel, FlowSubject } from '#/lib/curriculum/types';
import type { Classroom } from '#/queries/classrooms';
import type { components } from '#/queries/schema.gen';

import { nextRegularSemester } from '#/lib/offer';
import { finalGrade } from '#/queries/classrooms';

type Grade = components['schemas']['Grade'];

export const GRADES: Grade[] = ['SS', 'MS', 'MM', 'MI', 'II', 'SR'];
const APPROVED: ReadonlySet<Grade> = new Set(['SS', 'MS', 'MM']);

export interface Tally {
    subjects: number;
    hours: number;
}

export interface FlowStatistics {
    total: Tally;
    completed: Tally;
    enrolled: Tally;
    overdue: FlowSubject[];
    /** Pendentes cujos pré-requisitos já foram cumpridos. */
    available: FlowSubject[];
    periods: { period: number; total: number; completed: number; enrolled: number }[];
    /** Menor número de semestres para o resto, pela cadeia de pré-requisitos. */
    remainingSemesters: number;
}

const tally = (subjects: FlowSubject[]): Tally => ({
    subjects: subjects.length,
    hours: subjects.reduce((total, subject) => total + (subject.hours ?? 0), 0)
});

/** Algum grupo de pré-requisitos inteiro já aprovado, ou nenhum exigido. */
const prerequisitesMet = (subject: FlowSubject, done: ReadonlySet<string>) =>
    !subject.prerequisites?.length ||
    subject.prerequisites.some(
        (group) => group.length > 0 && group.every(({ code }) => done.has(code))
    );

/** Números do fluxo obrigatório a partir do estado de cada matéria. */
export function flowStatistics(
    model: CurriculumModel,
    state: (subject: FlowSubject) => AcademicState
): FlowStatistics {
    const states = new Map(model.subjects.map((subject) => [subject.code, state(subject)]));
    const withState = (wanted: AcademicState) =>
        model.subjects.filter((subject) => states.get(subject.code) === wanted);
    const done = new Set(withState('completed').map((subject) => subject.code));
    const open = model.subjects.filter(
        (subject) => !done.has(subject.code) && states.get(subject.code) !== 'enrolled'
    );

    // profundidade de cada matéria restante na cadeia de pré-requisitos também restantes
    const remaining = new Set(open.map((subject) => subject.code));
    const depth = new Map<string, number>();
    for (const subject of open.toSorted((a, b) => a.period - b.period)) {
        const before = model.edges
            .filter(
                (edge) =>
                    edge.kind === 'prerequisite' &&
                    edge.target === subject.code &&
                    remaining.has(edge.source)
            )
            .map((edge) => depth.get(edge.source) ?? 1);
        depth.set(subject.code, 1 + Math.max(0, ...before));
    }

    return {
        total: tally(model.subjects),
        completed: tally(withState('completed')),
        enrolled: tally(withState('enrolled')),
        overdue: withState('overdue'),
        available: open.filter((subject) => prerequisitesMet(subject, done)),
        periods: model.periods.map((period) => {
            const items = model.subjects.filter((subject) => subject.period === period);
            const count = (wanted: AcademicState) =>
                items.filter((subject) => states.get(subject.code) === wanted).length;
            return {
                period,
                total: items.length,
                completed: count('completed'),
                enrolled: count('enrolled')
            };
        }),
        remainingSemesters: Math.max(0, ...depth.values())
    };
}

/** Semestre em que o último dos `count` semestres restantes termina, a partir de `current`. */
export function projectedSemester(current: string, count: number) {
    let semester = current;
    for (let index = 0; index < count; index++) semester = nextRegularSemester(semester);
    return semester;
}

export interface HistoryStatistics {
    grades: Record<Grade, number>;
    graded: number;
    approvalRate: number | null;
    dropped: number;
    /** Horas aprovadas por semestre, do mais antigo ao mais recente. */
    hoursBySemester: { semester: string; hours: number }[];
}

/** Menções, aprovação e carga aprovada por semestre nas turmas encerradas. */
export function historyStatistics(history: Classroom[]): HistoryStatistics {
    const grades: Record<Grade, number> = { SS: 0, MS: 0, MM: 0, MI: 0, II: 0, SR: 0 };
    const hours = new Map<string, number>();
    let approved = 0;
    for (const classroom of history) {
        const grade = finalGrade(classroom);
        if (!grade) continue;
        grades[grade] += 1;
        if (!APPROVED.has(grade)) continue;
        approved += 1;
        hours.set(
            classroom.semester,
            (hours.get(classroom.semester) ?? 0) + (classroom.subject.hours ?? 0)
        );
    }
    const graded = GRADES.reduce((total, grade) => total + grades[grade], 0);
    return {
        grades,
        graded,
        approvalRate: graded ? Math.round((approved / graded) * 100) : null,
        dropped: history.filter((classroom) => classroom.status === 'trancado').length,
        hoursBySemester: [...hours]
            .map(([semester, total]) => ({ semester, hours: total }))
            .toSorted((a, b) => a.semester.localeCompare(b.semester))
    };
}
