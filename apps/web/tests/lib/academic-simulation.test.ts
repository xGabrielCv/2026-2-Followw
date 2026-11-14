import { expect, test } from 'bun:test';

import type { Classroom } from '#/queries/classrooms';

import {
    isFreeModule,
    simulateIndexes,
    simulationClassrooms,
    simulationKey
} from '#/lib/academic-simulation';
import { groupBySemester } from '#/lib/classroom-details';

function turma(
    code: string,
    semester: string,
    grade: Classroom['grade'],
    hours: number | null = 60
): Classroom {
    return {
        id: `${code}-${semester}`,
        semester,
        current: false,
        number: '01',
        subject: { code, name: code, hours },
        professors: [],
        grade
    };
}

test('pondera o IRA pelo semestre até seis e exclui módulo livre somente da MP', () => {
    const primeira = turma('A', '2023.1', 'SS', 30);
    const eletiva = turma('B', '2026.1', 'SR');
    const atual = turma('A', '2026.2', null);
    const semestres = groupBySemester([primeira, eletiva, atual]);
    const matriz = new Set(['A']);
    const inicial = simulateIndexes(semestres, '2023.1', '2026.2', matriz, {});
    expect(inicial.ira).toBeCloseTo(150 / 390);
    expect(inicial.mp).toBe(5);
    expect(inicial.evolution.map(({ semester }) => semester)).toEqual(['2023.1', '2026.1']);

    const simulado = simulateIndexes(semestres, '2023.1', '2026.2', matriz, {
        [simulationKey(primeira)]: 'MM',
        [simulationKey(atual)]: 'MS'
    });
    expect(simulado.ira).toBeCloseTo(1530 / 750);
    expect(simulado.mp).toBeCloseTo(330 / 90);
    expect(simulado.evolution).toEqual([
        { semester: '2023.1', ira: 3, projected: false },
        { semester: '2026.1', ira: 90 / 390, projected: false },
        { semester: '2026.2', ira: 1530 / 750, projected: true }
    ]);
});

test('ignora carga ausente e distingue SR de disciplina sem menção', () => {
    const atual = { ...turma('A', '2026.2', 'SR'), current: true };
    const semestres = groupBySemester([atual, turma('B', '2026.2', 'SS', null)]);
    const inicial = simulateIndexes(semestres, '2026.2', '2026.2', null, {});
    expect(inicial).toEqual({
        ira: 0,
        mp: null,
        evolution: [{ semester: '2026.2', ira: 0, projected: true }]
    });
    expect(
        simulateIndexes(semestres, '2026.2', '2026.2', null, {
            [simulationKey(atual)]: null
        })
    ).toEqual({ ira: null, mp: null, evolution: [] });
});

test('filtra vínculos fora da simulação e usa uma linha por matéria e semestre', () => {
    const matriculada = turma('A', '2026.2', 'MS');
    expect(
        simulationClassrooms(
            [
                turma('A', '2026.1', 'SS'),
                turma('A', '2026.2', null),
                matriculada,
                { ...turma('B', '2026.2', null), status: 'trancado' },
                { ...turma('C', '2026.2', null), status: 'pending_enrollment' },
                { ...turma('D', '2026.2', null), status: 'denied' },
                turma('A', '2027.1', null)
            ],
            '2026.2',
            '2026.2'
        )
    ).toEqual([matriculada]);
});

test('mantém tentativas em semestres distintos e normaliza o código da turma', () => {
    const anterior = turma(' a ', '2025.1', 'MI');
    const atual = turma('A', '2025.2', 'MS');
    expect(simulationKey(anterior)).toBe('2025.1:A');
    expect(simulationClassrooms([anterior, atual], '2025.1', '2025.2')).toEqual([anterior, atual]);
    expect(isFreeModule(anterior, new Set(['A']))).toBe(false);
    expect(isFreeModule(anterior, null)).toBe(false);
    const result = simulateIndexes(
        groupBySemester([atual, anterior]),
        '2025.1',
        '2025.2',
        new Set(['A']),
        {}
    );
    expect(result.ira).toBeCloseTo(10 / 3);
    expect(result.mp).toBe(3);
});

test('sem ingresso calcula só MP e ignora cargas não positivas', () => {
    const classrooms = [
        turma('A', '2025.1', 'SS'),
        turma('B', '2025.1', 'SR', 0),
        turma('C', '2025.1', 'SR', -15)
    ];
    const result = simulateIndexes(
        groupBySemester(classrooms),
        null,
        '2025.1',
        new Set(['A', 'B', 'C']),
        {}
    );
    expect(result).toEqual({ ira: null, mp: 5, evolution: [] });
});
