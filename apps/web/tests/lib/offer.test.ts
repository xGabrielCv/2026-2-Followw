import { describe, expect, test } from 'bun:test';

import {
    canAddToSchedule,
    currentRegularSemester,
    enrollmentStart,
    nextRegularSemester,
    offerChoices,
    semesterParam
} from '#/lib/offer';

test('nextRegularSemester pula as férias', () => {
    expect(nextRegularSemester('2026.1')).toBe('2026.2');
    expect(nextRegularSemester('2026.2')).toBe('2027.1');
});

test('currentRegularSemester mantém o semestre regular durante as férias', () => {
    expect(currentRegularSemester('2026-11-07')).toBe('2026.2');
    expect(currentRegularSemester('2027-01-15')).toBe('2026.2');
    expect(currentRegularSemester('2027-02-23')).toBe('2027.1');
});

test('enrollmentStart lê a matrícula do calendário', () => {
    expect(enrollmentStart('2027.1')).toBe('2027-02-22');
    expect(enrollmentStart('2099.1')).toBeUndefined();
});

describe('offerChoices', () => {
    test('próximo semestre sem oferta fica indisponível e o atual é o padrão', () => {
        const { choices, resolve } = offerChoices(['2026.2'], '2026-11-07');
        expect(choices).toEqual([
            { semester: '2027.1', kind: 'next', available: false },
            { semester: '2026.2', kind: 'current', available: true }
        ]);
        expect(resolve(null)).toBe('2026.2');
        expect(resolve('2027.1')).toBe('2026.2');
    });

    test('com a oferta do próximo, ele é o padrão mas permite escolher o atual', () => {
        const { choices, resolve } = offerChoices(['2027.1', '2026.2'], '2026-11-07');
        expect(choices).toEqual([
            { semester: '2027.1', kind: 'next', available: true },
            { semester: '2026.2', kind: 'current', available: true }
        ]);
        expect(resolve(null)).toBe('2027.1');
        expect(resolve('2026.2')).toBe('2026.2');
    });
});

test('semesterParam omite o padrão da API', () => {
    expect(semesterParam('2027.1', ['2027.1', '2026.2'])).toBeUndefined();
    expect(semesterParam('2026.2', ['2027.1', '2026.2'])).toBe('2026.2');
    expect(semesterParam(undefined, [])).toBeUndefined();
});

test('canAddToSchedule libera futuro, bloqueia passado e exige matrícula ou flag para o atual', () => {
    expect(
        canAddToSchedule('2027.1', { today: '2026-11-07', allowCurrentOutsideEnrollment: false })
    ).toBe(true);
    expect(
        canAddToSchedule('2026.1', { today: '2026-11-07', allowCurrentOutsideEnrollment: false })
    ).toBe(false);
    expect(
        canAddToSchedule('2026.2', { today: '2026-11-07', allowCurrentOutsideEnrollment: false })
    ).toBe(false);
    expect(
        canAddToSchedule('2026.2', { today: '2026-11-07', allowCurrentOutsideEnrollment: true })
    ).toBe(true);
    // durante a matrícula oficial de 2027.1 (22/02 a 24/02/2027), o semestre atual pode ser montado
    expect(
        canAddToSchedule('2027.1', { today: '2027-02-23', allowCurrentOutsideEnrollment: false })
    ).toBe(true);
    // além de 2027 continua estimando sem travar
    expect(currentRegularSemester('2032-09-10')).toBe('2032.2');
});
