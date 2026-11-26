import type { components } from '#/queries/schema.gen';

import { api } from '#/queries/api';

export type CourseIndicatorsCatalog = components['schemas']['CourseIndicatorsCatalog'];
export type CourseIndicatorSummary = components['schemas']['CourseIndicatorSummary'];
export type CourseIndicatorsDetail = components['schemas']['CourseIndicatorsDetail'];
export type CourseYearMetrics = components['schemas']['CourseYearMetrics'];
export type PasCycleEntry = components['schemas']['PasCycleEntry'];
export type UnbDashboardSummary = components['schemas']['UnbDashboardSummary'];

const STALE_TIME = 30 * 60_000;

export const coursesIndicatorsSummaryQueryOptions = api.queryOptions(
    'get',
    '/public/courses/indicators',
    {},
    { staleTime: STALE_TIME }
);

export const courseIndicatorsQueryOptions = (
    courseId: number,
    degree?: string | null,
    modality?: string | null
) =>
    api.queryOptions(
        'get',
        '/public/courses/{course_id}/indicators',
        {
            params: {
                path: { course_id: courseId },
                query: {
                    ...(degree ? { degree } : {}),
                    ...(modality ? { modality } : {})
                }
            }
        },
        { staleTime: STALE_TIME }
    );

export function formatPasScore(value: string | number | null | undefined): string {
    if (value == null) return 'Não informado';
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return String(value);
    return new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3
    }).format(numeric);
}

export function formatIndicatorNumber(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '—';
    return new Intl.NumberFormat('pt-BR').format(value);
}

export function formatIndicatorPercent(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '—';
    return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)}%`;
}
