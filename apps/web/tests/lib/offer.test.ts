import { describe, expect, test } from 'bun:test';

import {
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
            { semester: '2026.2', kind: 'current', available: true },
            { semester: '2027.1', kind: 'next', available: false }
        ]);
        expect(resolve(null)).toBe('2026.2');
        expect(resolve('2027.1')).toBe('2026.2');
    });

    test('com a oferta do próximo, ele pode ser escolhido sem virar o padrão', () => {
        const { resolve } = offerChoices(['2027.1', '2026.2'], '2026-11-07');
        expect(resolve(null)).toBe('2026.2');
        expect(resolve('2027.1')).toBe('2027.1');
    });
});

test('semesterParam omite o padrão da API', () => {
    expect(semesterParam('2027.1', ['2027.1', '2026.2'])).toBeUndefined();
    expect(semesterParam('2026.2', ['2027.1', '2026.2'])).toBe('2026.2');
    expect(semesterParam(undefined, [])).toBeUndefined();
});
