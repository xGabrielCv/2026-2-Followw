import { describe, expect, test } from 'bun:test';

import type { PlannedClass } from '#/lib/planned-schedule';

import { overlaps, parseSchedule } from '#/lib/schedule';
import {
    DEFAULT_PREFERENCES,
    metricsOf,
    type Preferences,
    suggestSchedules,
    type Subject,
    subjectsFromPlans
} from '#/lib/schedule-optimizer';

const turma = (code: string, number: string, schedule: string, hours = 60): PlannedClass => ({
    code,
    name: `MATÉRIA ${code}`,
    hours,
    number,
    semester: '2027.1',
    schedule,
    room: 'S1',
    professors: []
});

const materia = (code: string, required: boolean, ...options: PlannedClass[]): Subject => ({
    code,
    name: `MATÉRIA ${code}`,
    required,
    options
});

test('pré-requisito conhecido não pode ser cumprido na mesma grade e correquisito precisa estar junto', () => {
    const a = turma('A', '01', '24M12');
    const b = { ...turma('B', '01', '35M12'), prerequisites: [[{ code: 'A' }]] };
    const input = [materia('A', true, a), materia('B', true, b)];
    const blocked = suggestSchedules(input);
    expect(blocked.suggestions).toEqual([]);
    expect(blocked.impossible.map((item) => item.code)).toContain('B');
    expect(
        suggestSchedules(input, { ...DEFAULT_PREFERENCES, completedCodes: ['A'] }).suggestions
            .length
    ).toBeGreaterThan(0);
    const corequisite = { ...b, prerequisites: null, corequisites: [[{ code: 'A' }]] };
    const plans = suggestSchedules([materia('A', false, a), materia('B', true, corequisite)]);
    expect(plans.suggestions.length).toBeGreaterThan(0);
    expect(plans.suggestions.every((plan) => plan.items.some((item) => item.code === 'A'))).toBe(
        true
    );
});

const prefs = (extra: Partial<Preferences> = {}): Preferences => ({
    ...DEFAULT_PREFERENCES,
    ...extra
});

const valid = (items: PlannedClass[]) => {
    const times = items.flatMap((item) => parseSchedule(item.schedule));
    return times.every((a, i) => times.every((b, j) => i === j || !overlaps(a, b)));
};

describe('simulador 2.0', () => {
    test('nunca sugere grade com choque de horário nem matéria repetida', () => {
        const subjects = [
            materia('A', true, turma('A', '01', '24M12'), turma('A', '02', '35T23')),
            materia('B', true, turma('B', '01', '24M12'), turma('B', '02', '35M34')),
            materia('C', true, turma('C', '01', '24T23'))
        ];
        const { suggestions } = suggestSchedules(subjects, prefs(), 10);
        expect(suggestions.length).toBeGreaterThan(0);
        for (const { items } of suggestions) {
            expect(valid(items)).toBe(true);
            expect(new Set(items.map((item) => item.code)).size).toBe(items.length);
            expect(items.map((item) => item.code).toSorted()).toEqual(['A', 'B', 'C']);
        }
    });

    test('prefere menos dias no campus quando o peso é alto', () => {
        const subjects = [
            materia('A', true, turma('A', '01', '24M12'), turma('A', '02', '25M12')),
            materia('B', true, turma('B', '01', '24M34'), turma('B', '02', '35T23'))
        ];
        const [first] = suggestSchedules(
            subjects,
            prefs({ weights: { ...DEFAULT_PREFERENCES.weights, fewerDays: 3 } })
        ).suggestions;
        expect(first.metrics.days).toBe(2);
        expect(first.reasons[0]).toBe('2 dias no campus');
    });

    test('prefere menos janelas entre as aulas', () => {
        const subjects = [
            materia('A', true, turma('A', '01', '2M12')),
            materia('B', true, turma('B', '01', '2M34'), turma('B', '02', '2T45'))
        ];
        const [first] = suggestSchedules(
            subjects,
            prefs({
                weights: { fewerDays: 0, fewerGaps: 3, avoidShifts: 0, balance: 0, progress: 0 }
            })
        ).suggestions;
        expect(first.items.find((item) => item.code === 'B')?.number).toBe('01');
        expect(first.metrics.gapMinutes).toBe(10);
        expect(
            metricsOf([turma('A', '01', '2M12'), turma('B', '02', '2T45')]).gapMinutes
        ).toBeGreaterThan(100);
    });

    test('dias e horários bloqueados são regra, não preferência', () => {
        const subjects = [
            materia('A', true, turma('A', '01', '2M12'), turma('A', '02', '3M12')),
            materia('B', false, turma('B', '01', '4M12'))
        ];
        const { suggestions } = suggestSchedules(
            subjects,
            prefs({
                blockedWeekdays: [1],
                blockedTimes: [{ weekday: 3, start: '08:00', end: '10:00' }]
            })
        );
        expect(suggestions).toHaveLength(1);
        expect(suggestions[0].items.map((item) => `${item.code}-${item.number}`)).toEqual(['A-02']);
        expect(suggestions[0].left[0]).toMatchObject({ code: 'B' });
        expect(suggestions[0].left[0].reason).toContain('nenhuma turma serve');
    });

    test('evitar turno empurra a grade para outro horário, mas não proíbe', () => {
        const subjects = [
            materia('A', true, turma('A', '01', '2N12'), turma('A', '02', '2M12')),
            materia('B', true, turma('B', '01', '3N12'))
        ];
        const [first] = suggestSchedules(subjects, prefs({ avoidShifts: ['night'] })).suggestions;
        expect(first.items.find((item) => item.code === 'A')?.number).toBe('02');
        expect(first.metrics.shiftMinutes.night).toBeGreaterThan(0); // B só tem turma à noite
        expect(
            first.reasons.some((reason) => reason.includes('turno que você prefere evitar'))
        ).toBe(true);
    });

    test('respeita a carga horária máxima', () => {
        const subjects = [
            materia('A', true, turma('A', '01', '2M12', 60)),
            materia('B', false, turma('B', '01', '3M12', 60)),
            materia('C', false, turma('C', '01', '4M12', 60))
        ];
        const { suggestions } = suggestSchedules(subjects, prefs({ maxHours: 120 }), 20);
        for (const { items } of suggestions)
            expect(items.reduce((total, item) => total + (item.hours ?? 0), 0)).toBeLessThanOrEqual(
                120
            );
        expect(suggestions[0].items).toHaveLength(2);
    });

    test('matérias opcionais entram quando cabem e a melhor grade as inclui', () => {
        const subjects = [
            materia('A', true, turma('A', '01', '2M12')),
            materia('B', false, turma('B', '01', '3M12')),
            materia('C', false, turma('C', '01', '2M12'))
        ];
        const [first] = suggestSchedules(subjects).suggestions;
        expect(first.items.map((item) => item.code).toSorted()).toEqual(['A', 'B']);
        expect(first.left).toEqual([
            { code: 'C', name: 'MATÉRIA C', reason: 'todas as turmas batem com MATÉRIA A' }
        ]);
    });

    test('matéria prioritária ganha a disputa por um horário', () => {
        const subjects = [
            materia('A', true, turma('A', '01', '5M12')),
            materia('B', false, turma('B', '01', '2M12')),
            materia('C', false, turma('C', '01', '2M12'))
        ];
        const [first] = suggestSchedules(subjects, prefs({ priority: ['C'] })).suggestions;
        expect(first.items.map((item) => item.code).toSorted()).toEqual(['A', 'C']);
    });

    test('explica quando duas obrigatórias não cabem juntas', () => {
        const subjects = [
            materia('A', true, turma('A', '01', '2M12')),
            materia('B', true, turma('B', '01', '2M12'))
        ];
        const result = suggestSchedules(subjects);
        expect(result.suggestions).toEqual([]);
        expect(result.impossible[0].reason).toContain('batem com');
    });

    test('obrigatória sem turma possível é apontada antes de buscar', () => {
        const subjects = [materia('A', true, turma('A', '01', '2M12'))];
        const result = suggestSchedules(subjects, prefs({ blockedWeekdays: [1] }));
        expect(result.impossible).toEqual([
            {
                code: 'A',
                name: 'MATÉRIA A',
                reason: 'nenhuma turma serve: tem aula em um dia bloqueado'
            }
        ]);
    });

    test('é determinístico: o mesmo pedido dá a mesma resposta', () => {
        const subjects = [
            materia('A', true, turma('A', '01', '24M12'), turma('A', '02', '35T23')),
            materia('B', true, turma('B', '01', '24M34'), turma('B', '02', '35M34')),
            materia('C', false, turma('C', '01', '6M12'), turma('C', '02', '6T12'))
        ];
        const first = suggestSchedules(subjects, prefs(), 5);
        const second = suggestSchedules(subjects.toReversed(), prefs(), 5);
        const key = (r: typeof first) =>
            r.suggestions.map((s) =>
                s.items
                    .map((i) => `${i.code}-${i.number}`)
                    .toSorted()
                    .join()
            );
        expect(key(second)).toEqual(key(first));
    });

    test('muitas combinações terminam rápido e avisam quando cortam a busca', () => {
        // 10 matérias x 6 turmas: 60 milhões de combinações sem poda
        const days = ['2', '3', '4', '5', '6', '24', '35', '46', '25', '36'];
        const slots = ['M12', 'M34', 'T12', 'T34', 'T56', 'N12'];
        const subjects = Array.from({ length: 10 }, (_, s) =>
            materia(
                `S${s}`,
                s < 4,
                ...Array.from({ length: 6 }, (__, o) =>
                    turma(
                        `S${s}`,
                        String(o + 1).padStart(2, '0'),
                        `${days[(s + o) % 10]}${slots[(s * 2 + o) % 6]}`
                    )
                )
            )
        );
        const started = performance.now();
        const result = suggestSchedules(subjects, prefs(), 3);
        expect(performance.now() - started).toBeLessThan(1500);
        expect(result.truncated).toBe(true);
        for (const { items } of result.suggestions) expect(valid(items)).toBe(true);
    });

    test('agrupa as turmas das grades por matéria, sem repetir a mesma turma', () => {
        const items = [
            turma('A', '01', '2M12'),
            turma('A', '02', '3M12'),
            turma('A', '01', '2M12'),
            turma('B', '01', '4M12')
        ];
        const subjects = subjectsFromPlans(items, new Set(['B']));
        expect(subjects.map((s) => [s.code, s.required, s.options.length])).toEqual([
            ['A', true, 2],
            ['B', false, 1]
        ]);
    });
});
