import { afterEach, describe, expect, test } from 'bun:test';

import type { Comparison } from '#/queries/comparison';

import {
    readStatisticsSource,
    resolveComparisonData,
    resolveOutcomeRates,
    saveStatisticsSource
} from '#/lib/statistics-source';

import { useDom } from '../helpers/dom';

useDom();

afterEach(() => {
    saveStatisticsSource('hybrid');
});

const FW = { classrooms: 3, approved: 80, failed: 15, dropped: 5 };
const EXT = {
    classrooms: 1,
    approved: 60,
    failed: 30,
    dropped: 10,
    enrolled: 120,
    source: 'tamburetei' as const,
    semesters: ['2024.2']
};

describe('preferência e resolução da fonte de estatísticas públicas', () => {
    test('persiste a escolha e volta ao padrão híbrido', () => {
        expect(readStatisticsSource()).toBe('hybrid');
        saveStatisticsSource('average');
        expect(readStatisticsSource()).toBe('average');
        saveStatisticsSource('tamburetei');
        expect(readStatisticsSource()).toBe('tamburetei');
        saveStatisticsSource('hybrid');
        expect(readStatisticsSource()).toBe('hybrid');
    });

    test('modo híbrido prioriza Followw e completa lacunas com Tamburetei', () => {
        const both = resolveOutcomeRates(FW, EXT, 'hybrid');
        expect(both.origin).toBe('followw');
        expect(both.rates?.approved).toBe(80);

        const gap = resolveOutcomeRates(null, EXT, 'hybrid');
        expect(gap.origin).toBe('tamburetei');
        expect(gap.rates?.approved).toBe(60);
    });

    test('modo média combinada pondera Followw e Tamburetei', () => {
        const avg = resolveOutcomeRates(FW, EXT, 'average');
        expect(avg.origin).toBe('combined');
        expect(avg.rates).toEqual({
            classrooms: 4,
            approved: 75,
            failed: 18.8,
            dropped: 6.3
        });
    });

    test('modos exclusivos isolam Followw ou Tamburetei', () => {
        expect(resolveOutcomeRates(null, EXT, 'followw').rates).toBeNull();
        expect(resolveOutcomeRates(FW, null, 'tamburetei').rates).toBeNull();
        expect(resolveOutcomeRates(FW, EXT, 'tamburetei').origin).toBe('tamburetei');
    });

    test('resolveComparisonData mescla matérias conforme o modo escolhido', () => {
        const base: Comparison = {
            unb: FW,
            course: FW,
            subjects: [{ code: 'CIC0004', name: 'APC', rates: FW }],
            external_subjects: [
                { code: 'CIC0004', name: 'APC', rates: EXT },
                { code: 'MAT0025', name: 'CÁLCULO 1', rates: EXT }
            ],
            course_indicators: null,
            dashboard: null
        };

        const hybrid = resolveComparisonData(base, 'hybrid');
        expect(hybrid.comparison.subjects.map((s) => s.code)).toEqual(['MAT0025', 'CIC0004']);
        expect(hybrid.originByCode.get('CIC0004')).toBe('followw');
        expect(hybrid.originByCode.get('MAT0025')).toBe('tamburetei');

        const onlyFw = resolveComparisonData(base, 'followw');
        expect(onlyFw.comparison.subjects.map((s) => s.code)).toEqual(['CIC0004']);

        const average = resolveComparisonData(base, 'average');
        expect(average.originByCode.get('CIC0004')).toBe('combined');
        expect(average.originByCode.get('MAT0025')).toBe('tamburetei');
    });
});
