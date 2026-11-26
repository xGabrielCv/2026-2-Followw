import { useSyncExternalStore } from 'react';

import type { Comparison, SubjectRate } from '#/queries/comparison';
import type { OutcomeRates } from '#/queries/outcomes';
import type { components } from '#/queries/schema.gen';

import { STORAGE_KEYS, localStorageRepository } from '#/lib/local-storage';

export type ExternalOutcomeRates = components['schemas']['ExternalOutcomeRates'];
export type ExternalSubjectRate = components['schemas']['ExternalSubjectRate'];

export const STATISTICS_SOURCES = ['average', 'hybrid', 'followw', 'tamburetei'] as const;
export type StatisticsSource = (typeof STATISTICS_SOURCES)[number];
export type ResolvedOrigin = 'followw' | 'tamburetei' | 'combined';

export const DEFAULT_STATISTICS_SOURCE: StatisticsSource = 'average';

export const STATISTICS_SOURCE_LABELS: Record<StatisticsSource, string> = {
    average: 'Média combinada',
    hybrid: 'Followw + auxiliar',
    followw: 'Só Followw',
    tamburetei: 'Só Tamburetei'
};

export const STATISTICS_SOURCE_DESCRIPTIONS: Record<StatisticsSource, string> = {
    average:
        'Combina Followw e Tamburetei/DPO por média ponderada quando ambos têm dados e usa a fonte disponível quando só um tem.',
    hybrid: 'Prioriza as turmas compartilhadas no Followw e completa lacunas com o histórico público do Tamburetei/DPO.',
    followw: 'Exibe apenas as médias das turmas liberadas por estudantes do Followw.',
    tamburetei: 'Exibe apenas os índices históricos públicos do Tamburetei UnB / DPO.'
};

export const ORIGIN_LABELS: Record<ResolvedOrigin, string> = {
    followw: 'Followw',
    tamburetei: 'Tamburetei / DPO',
    combined: 'Média Followw + Tamburetei'
};

export function isStatisticsSource(value: unknown): value is StatisticsSource {
    return STATISTICS_SOURCES.some((item) => item === value);
}

export function readStatisticsSource(): StatisticsSource {
    const stored = localStorageRepository.get(STORAGE_KEYS.STATS_SOURCE);
    return isStatisticsSource(stored) ? stored : DEFAULT_STATISTICS_SOURCE;
}

const listeners = new Set<() => void>();

export function subscribeStatisticsSource(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function saveStatisticsSource(mode: StatisticsSource): void {
    if (mode === DEFAULT_STATISTICS_SOURCE)
        localStorageRepository.remove(STORAGE_KEYS.STATS_SOURCE);
    else localStorageRepository.set(STORAGE_KEYS.STATS_SOURCE, mode);
    for (const listener of listeners) listener();
}

export function useStatisticsSource(): StatisticsSource {
    return useSyncExternalStore(
        subscribeStatisticsSource,
        readStatisticsSource,
        () => DEFAULT_STATISTICS_SOURCE
    );
}

const round1 = (value: number) => Math.round(value * 10) / 10;

function toOutcomeRates(external: ExternalOutcomeRates): OutcomeRates {
    return {
        classrooms: external.classrooms,
        approved: external.approved,
        failed: external.failed,
        dropped: external.dropped
    };
}

function weightedAverage(followw: OutcomeRates, external: ExternalOutcomeRates): OutcomeRates {
    const w1 = Math.max(followw.classrooms, 1);
    const w2 = Math.max(external.classrooms, 1);
    const total = w1 + w2;
    return {
        classrooms: followw.classrooms + external.classrooms,
        approved: round1((followw.approved * w1 + external.approved * w2) / total),
        failed: round1((followw.failed * w1 + external.failed * w2) / total),
        dropped: round1((followw.dropped * w1 + external.dropped * w2) / total)
    };
}

export interface ResolvedRates {
    rates: OutcomeRates | null;
    origin: ResolvedOrigin | null;
    label: string | null;
}

/** Resolve o índice exibido de acordo com a preferência de origem escolhida em Perfil › Conta. */
export function resolveOutcomeRates(
    followw: OutcomeRates | null | undefined,
    external: ExternalOutcomeRates | null | undefined,
    mode: StatisticsSource
): ResolvedRates {
    const fw = followw ?? null;
    const ext = external ?? null;

    if (mode === 'followw') {
        return fw
            ? { rates: fw, origin: 'followw', label: ORIGIN_LABELS.followw }
            : { rates: null, origin: null, label: null };
    }
    if (mode === 'tamburetei') {
        return ext
            ? {
                  rates: toOutcomeRates(ext),
                  origin: 'tamburetei',
                  label: ORIGIN_LABELS.tamburetei
              }
            : { rates: null, origin: null, label: null };
    }
    if (mode === 'average') {
        if (fw && ext) {
            return {
                rates: weightedAverage(fw, ext),
                origin: 'combined',
                label: ORIGIN_LABELS.combined
            };
        }
        if (fw) return { rates: fw, origin: 'followw', label: ORIGIN_LABELS.followw };
        if (ext) {
            return {
                rates: toOutcomeRates(ext),
                origin: 'tamburetei',
                label: ORIGIN_LABELS.tamburetei
            };
        }
        return { rates: null, origin: null, label: null };
    }
    // hybrid (padrão): prioriza Followw e completa com Tamburetei quando não houver turmas no Followw
    if (fw) return { rates: fw, origin: 'followw', label: ORIGIN_LABELS.followw };
    if (ext) {
        return {
            rates: toOutcomeRates(ext),
            origin: 'tamburetei',
            label: ORIGIN_LABELS.tamburetei
        };
    }
    return { rates: null, origin: null, label: null };
}

function summarizeSubjects(items: SubjectRate[]): OutcomeRates | null {
    if (items.length === 0) return null;
    const totalClassrooms = items.reduce(
        (sum, item) => sum + Math.max(item.rates.classrooms, 1),
        0
    );
    const avg = (pick: (rate: OutcomeRates) => number) =>
        round1(
            items.reduce(
                (sum, item) => sum + pick(item.rates) * Math.max(item.rates.classrooms, 1),
                0
            ) / totalClassrooms
        );
    return {
        classrooms: totalClassrooms,
        approved: avg((r) => r.approved),
        failed: avg((r) => r.failed),
        dropped: avg((r) => r.dropped)
    };
}

export interface ResolvedComparison {
    comparison: Comparison;
    originByCode: Map<string, ResolvedOrigin>;
}

/** Aplica a preferência de fonte sobre `/public/subjects/comparison` inteiramente no aparelho. */
export function resolveComparisonData(
    data: Comparison,
    mode: StatisticsSource
): ResolvedComparison {
    const followwByCode = new Map(data.subjects.map((item) => [item.code, item]));
    const externalByCode = new Map((data.external_subjects ?? []).map((item) => [item.code, item]));
    const codes = new Set([...followwByCode.keys(), ...externalByCode.keys()]);
    const originByCode = new Map<string, ResolvedOrigin>();
    const merged: SubjectRate[] = [];

    for (const code of codes) {
        const fw = followwByCode.get(code);
        const ext = externalByCode.get(code);
        const resolved = resolveOutcomeRates(fw?.rates, ext?.rates, mode);
        if (!resolved.rates || !resolved.origin) continue;
        originByCode.set(code, resolved.origin);
        merged.push({
            code,
            name: fw?.name ?? ext?.name ?? code,
            rates: resolved.rates
        });
    }
    merged.sort((a, b) => b.rates.failed - a.rates.failed || a.code.localeCompare(b.code));

    if (mode === 'followw') {
        return {
            comparison: { ...data, subjects: merged },
            originByCode
        };
    }

    const derived = summarizeSubjects(merged);
    const nextUnb =
        mode === 'tamburetei'
            ? derived
            : mode === 'average'
              ? (derived ?? data.unb)
              : (data.unb ?? derived);
    const nextCourse =
        mode === 'tamburetei'
            ? derived
            : mode === 'average'
              ? (derived ?? data.course)
              : (data.course ?? derived);

    return {
        comparison: {
            ...data,
            unb: nextUnb,
            course: nextCourse,
            subjects: merged
        },
        originByCode
    };
}
