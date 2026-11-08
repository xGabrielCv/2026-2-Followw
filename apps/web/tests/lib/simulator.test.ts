import { afterEach, describe, expect, test } from 'bun:test';

import type { PlannedClass } from '#/lib/planned-schedule';

import {
    activePlan,
    createPlan,
    deletePlan,
    MAX_PLANS,
    plannedSchedule,
    renamePlan,
    schedulePlans,
    selectPlan
} from '#/lib/planned-schedule';
import { averageRating, planMetrics } from '#/lib/schedule-compare';

const turma = (code: string, schedule: string, siape: number | null = null): PlannedClass => ({
    code,
    name: code,
    hours: 60,
    number: '01',
    semester: '2027.1',
    schedule,
    room: null,
    professors: [{ name: 'Docente', siape, photo: null, email: null }]
});

afterEach(() => schedulePlans.clear());

describe('várias grades no simulador', () => {
    test('a grade ativa é a que a busca e Minhas Turmas usam', () => {
        plannedSchedule.set([turma('A', '24M12')]);
        const segunda = createPlan();
        expect(segunda).not.toBeNull();
        // a nova grade já fica ativa e começa vazia
        expect(plannedSchedule.getSnapshot()).toEqual([]);
        plannedSchedule.set([turma('B', '35T23')]);

        selectPlan(schedulePlans.getSnapshot().plans[0].id);
        expect(plannedSchedule.getSnapshot().map((item) => item.code)).toEqual(['A']);
        expect(schedulePlans.getSnapshot().plans.map((plan) => plan.name)).toEqual([
            'Grade 1',
            'Grade 2'
        ]);
    });

    test('duplicar, renomear e apagar; a última grade nunca some', () => {
        plannedSchedule.set([turma('A', '24M12')]);
        const first = activePlan(schedulePlans.getSnapshot()).id;
        const copy = createPlan(first)!;
        expect(activePlan(schedulePlans.getSnapshot()).items.map((item) => item.code)).toEqual([
            'A'
        ]);
        renamePlan(copy, '  Grade da manhã  ');
        expect(activePlan(schedulePlans.getSnapshot()).name).toBe('Grade da manhã');
        renamePlan(copy, '   ');
        expect(activePlan(schedulePlans.getSnapshot()).name).toBe('Grade da manhã');

        deletePlan(copy);
        expect(activePlan(schedulePlans.getSnapshot()).id).toBe(first);
        deletePlan(first);
        expect(schedulePlans.getSnapshot().plans).toHaveLength(1);
        expect(plannedSchedule.getSnapshot()).toEqual([]);
    });

    test(`no máximo ${MAX_PLANS} grades`, () => {
        for (let index = 1; index < MAX_PLANS; index++) expect(createPlan()).not.toBeNull();
        expect(createPlan()).toBeNull();
        expect(schedulePlans.getSnapshot().plans).toHaveLength(MAX_PLANS);
    });
});

describe('comparar grades', () => {
    test('conta turmas, horas, dias livres e turnos', () => {
        const metrics = planMetrics([turma('A', '24M12'), turma('B', '35T23'), turma('C', '6N12')]);
        expect(metrics).toMatchObject({
            classes: 3,
            hours: 180,
            days: 5,
            freeWeekdays: 0,
            morning: 2,
            afternoon: 2,
            night: 1,
            earliest: '08:00'
        });
        expect(planMetrics([]).freeWeekdays).toBe(5);
    });

    test('média das notas dos docentes, sem contar quem não tem nota', () => {
        const items = [turma('A', '24M12', 1), turma('B', '35T23', 2), turma('C', '6N12', 3)];
        expect(averageRating(items, { 1: { average: 80 }, 2: { average: 60 } })).toBe(70);
        expect(averageRating(items, {})).toBeNull();
    });
});
