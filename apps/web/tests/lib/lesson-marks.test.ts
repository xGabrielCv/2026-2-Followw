import { describe, expect, test } from 'bun:test';

import type { ClassroomFrequency, Lesson } from '#/queries/classrooms';

import {
    absenceRisk,
    frequencyTotals,
    lessonHours,
    setMarks,
    validMarks,
    withMarks
} from '#/lib/lesson-marks';

const lesson = (id: string, day: string, status: Lesson['status'], absences = 0): Lesson => ({
    id,
    occurred_on: day,
    start_time: '14:00:00',
    end_time: '15:50:00',
    status,
    absences,
    marked: false
});

const frequency = (patch: Partial<ClassroomFrequency> = {}): ClassroomFrequency => ({
    progress: { taught: 10, total: 60, percentage: 16 },
    frequency_status: 'parcialmente_registrada',
    lessons: [
        lesson('a', '2026-09-22', 'falta', 2),
        lesson('b', '2026-09-24', 'nao_registrada'),
        lesson('c', '2026-09-29', 'presente')
    ],
    upcoming: [lesson('d', '2026-10-06', 'nao_registrada')],
    totals: null,
    max_absences: 15,
    ...patch
});

describe('marcações de presença no navegador', () => {
    test('a marcação vale só onde o SIGAA não registrou a chamada', () => {
        const view = withMarks(frequency(), { a: 'presente', b: 'falta' });
        const byId = Object.fromEntries(view.lessons.map((l) => [l.id, l]));
        // a chamada do SIGAA vence a marcação
        expect(byId.a).toMatchObject({ status: 'falta', marked: false, absences: 2 });
        expect(byId.b).toMatchObject({ status: 'falta', marked: true, absences: 2 });
        expect(view.totals).toEqual({
            presences: 2,
            absences: 4,
            percentage: 33.3,
            max_absences: 15,
            estimated: true
        });
    });

    test('sem marcação que valha, a frequência do SIGAA fica igual', () => {
        const data = frequency({
            totals: {
                presences: 9,
                absences: 2,
                percentage: 81.8,
                max_absences: 15,
                estimated: false
            }
        });
        expect(withMarks(data, {})).toBe(data);
        expect(withMarks(data, { a: 'presente' })).toBe(data);
    });

    test('aula futura só pode ser cancelada e sai das próximas', () => {
        const view = withMarks(frequency(), { d: 'cancelada' });
        expect(view.upcoming).toEqual([]);
        expect(view.lessons[0]).toMatchObject({ id: 'd', status: 'cancelada', marked: true });
        expect(withMarks(frequency(), { d: 'presente' }).upcoming).toHaveLength(1);
    });

    test('grava, apaga e valida o que vem do storage', () => {
        let marks = setMarks({}, 'T1', ['a', 'b'], 'presente');
        expect(marks).toEqual({ T1: { a: 'presente', b: 'presente' } });
        marks = setMarks(marks, 'T1', ['a', 'b'], null);
        expect(marks).toEqual({});
        expect(validMarks({ T1: { a: 'falta' } })).toBe(true);
        expect(validMarks({ T1: { a: 'hackeado' } })).toBe(false);
        expect(validMarks([])).toBe(false);
        expect(validMarks({ T1: 'x' })).toBe(false);
    });

    test('horas-aula e totais como a API calcula', () => {
        expect(lessonHours('14:00:00', '15:50:00')).toBe(2);
        expect(lessonHours('19:00', '22:30')).toBe(4);
        expect(lessonHours(null, null)).toBe(1);
        expect(frequencyTotals([lesson('x', '2026-09-01', 'nao_registrada')], 15)).toBeNull();
    });
});

const totals = (absences: number, max: number | null = 15) => ({
    presences: 10,
    absences,
    percentage: 80,
    max_absences: max,
    estimated: false
});

describe('aviso de faltas (75% de presença)', () => {
    test('avisa perto do limite e quando passa dele', () => {
        expect(absenceRisk(totals(4))).toBeNull();
        expect(absenceRisk(totals(11))).toMatchObject({ level: 'warning', left: 4 });
        expect(absenceRisk(totals(15))).toMatchObject({ level: 'danger', left: 0 });
        expect(absenceRisk(totals(17))).toMatchObject({ level: 'danger', left: -2 });
        expect(absenceRisk(totals(17, null))).toBeNull();
        expect(absenceRisk(null)).toBeNull();
    });
});
