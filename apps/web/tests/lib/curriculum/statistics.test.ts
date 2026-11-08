import { describe, expect, test } from 'bun:test';

import type { Classroom } from '#/queries/classrooms';

import { academicState, normalizeCurriculum } from '#/lib/curriculum/model';
import { flowStatistics, historyStatistics, projectedSemester } from '#/lib/curriculum/statistics';

import { curriculum } from '../../helpers/curriculum';

// A -> B -> D em cadeia; C e E soltas
const model = normalizeCurriculum(
    curriculum({
        sigaa_id: 1,
        code: '01',
        course_id: 42,
        entry_semester: '2025.1',
        valid_from: '2024.1',
        matrix: 'Teste',
        shift: 'D',
        periods: [
            {
                period: 1,
                subjects: [
                    { code: 'A', name: 'Base', hours: 60 },
                    { code: 'C', name: 'Solta', hours: 30 }
                ]
            },
            {
                period: 2,
                subjects: [
                    { code: 'B', name: 'Meio', hours: 60, prerequisites: [['A']] },
                    { code: 'E', name: 'Livre', hours: 60 }
                ]
            },
            { period: 3, subjects: [{ code: 'D', name: 'Fim', hours: 90, prerequisites: [['B']] }] }
        ],
        complementary: []
    })
);

const classroom = (
    code: string,
    status: Classroom['status'],
    grade: Classroom['grade'] = null,
    semester = '2025.1',
    hours = 60
): Classroom => ({
    id: `${code}-${semester}`,
    subject: { code, name: code, hours },
    status,
    grade,
    current: false,
    number: '01',
    semester,
    professors: []
});

describe('flowStatistics', () => {
    test('conta concluídas, em curso, atrasadas e o que já pode ser cursado', () => {
        const state = academicState(
            [classroom('C', 'concluido', 'SS'), classroom('E', 'cursando')],
            2
        );
        const stats = flowStatistics(model, state);
        expect(stats.total).toEqual({ subjects: 5, hours: 300 });
        expect(stats.completed).toEqual({ subjects: 1, hours: 30 });
        expect(stats.enrolled).toEqual({ subjects: 1, hours: 60 });
        expect(stats.overdue.map((subject) => subject.code)).toEqual(['A', 'B']);
        expect(stats.available.map((subject) => subject.code)).toEqual(['A']);
        expect(stats.periods).toEqual([
            { period: 1, total: 2, completed: 1, enrolled: 0 },
            { period: 2, total: 2, completed: 0, enrolled: 1 },
            { period: 3, total: 1, completed: 0, enrolled: 0 }
        ]);
        // A, B e D ainda em cadeia
        expect(stats.remainingSemesters).toBe(3);
    });

    test('marcação manual libera a próxima da cadeia', () => {
        const stats = flowStatistics(model, academicState([], 1, new Set(['A'])));
        expect(stats.available.map((subject) => subject.code)).toEqual(['C', 'B', 'E']);
        expect(stats.remainingSemesters).toBe(2);
    });
});

test('projectedSemester avança só pelos semestres regulares', () => {
    expect(projectedSemester('2026.2', 0)).toBe('2026.2');
    expect(projectedSemester('2026.2', 3)).toBe('2028.1');
});

test('historyStatistics resume menções, aprovação e horas aprovadas por semestre', () => {
    const stats = historyStatistics([
        classroom('A', 'concluido', 'SS', '2025.1'),
        classroom('B', 'concluido', 'MI', '2025.1'),
        classroom('C', 'concluido', 'MM', '2025.2', 30),
        classroom('D', 'trancado'),
        classroom('E', 'cursando')
    ]);
    expect(stats.grades).toEqual({ SS: 1, MS: 0, MM: 1, MI: 1, II: 0, SR: 0 });
    expect(stats.graded).toBe(3);
    expect(stats.approvalRate).toBe(67);
    expect(stats.dropped).toBe(1);
    expect(stats.hoursBySemester).toEqual([
        { semester: '2025.1', hours: 60 },
        { semester: '2025.2', hours: 30 }
    ]);
});
