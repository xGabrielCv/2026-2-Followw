import type { SemesterCalendar } from '#/calendar';
import type { Classroom } from '#/queries/classrooms';

import { semesterProgress } from '#/calendar';

export const AUTO_SHARE_SEMESTER_PERCENT = 98;
export const AUTO_SHARE_INTERVAL_DAYS = 180;
const MS_PER_DAY = 86_400_000;

export interface SharingPolicyConfig {
    semester_percent?: number;
    interval_days?: number;
    trigger_id?: string | null;
}

export type AutoReshareReason =
    | 'manual_trigger'
    | 'semester_percent'
    | 'closed_semester'
    | 'periodic';

export interface AutoReshareDecision {
    shouldSync: boolean;
    syncKey: string | null;
    includeClosing: boolean;
    reason: AutoReshareReason | null;
    triggerId: string | null;
}

interface ParsedSyncKey {
    semester: string;
    isClosed: boolean;
    percent: number;
}

function parseSyncKey(key: string | null | undefined): ParsedSyncKey | null {
    if (!key) return null;
    const match = /^(\d{4}\.\d+):(closed|\d+)$/.exec(key);
    if (!match) return null;
    const [, semester, kind] = match;
    if (kind === 'closed') {
        return { semester, isClosed: true, percent: 100 };
    }
    return { semester, isClosed: false, percent: Number(kind) };
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Decide se o app deve reenviar anonimamente os índices das turmas do aluno que ativou
 * "Compartilhar índices das minhas turmas":
 * 1. Nunca compartilha se `enabled` for falso;
 * 2. Reenvia imediatamente se o admin disparou uma atualização global manual (`policy.trigger_id`);
 * 3. Reenvia quando o semestre atual atinge >= `policy.semester_percent` (padrão 98%);
 * 4. Reenvia quando existe um semestre encerrado mais recente ou que fechou após o marco parcial
 *    (recupera automaticamente janelas perdidas entre 90–100% e notas consolidadas depois);
 * 5. Reenvia se passou o intervalo periódico de segurança (`policy.interval_days`, padrão 180 dias).
 */
export function evaluateAutoReshare({
    enabled,
    classrooms,
    today,
    customCalendar,
    policy,
    lastSyncedKey,
    lastSyncedAt,
    lastTriggerId,
    nowMs
}: {
    enabled: boolean;
    classrooms: readonly Pick<Classroom, 'semester' | 'current'>[] | undefined;
    today: string;
    customCalendar?: Record<string, SemesterCalendar>;
    policy?: SharingPolicyConfig | null;
    lastSyncedKey?: string | null;
    lastSyncedAt?: string | null;
    lastTriggerId?: string | null;
    nowMs?: number;
}): AutoReshareDecision {
    if (!enabled) {
        return {
            shouldSync: false,
            syncKey: null,
            includeClosing: false,
            reason: null,
            triggerId: null
        };
    }

    const threshold = clamp(policy?.semester_percent ?? AUTO_SHARE_SEMESTER_PERCENT, 50, 100);
    const intervalDays = clamp(policy?.interval_days ?? AUTO_SHARE_INTERVAL_DAYS, 30, 365);
    const policyTriggerId = policy?.trigger_id?.trim() || null;

    const progress = semesterProgress(today, customCalendar);
    const closedSemesters = (classrooms ?? [])
        .filter((item) => !item.current)
        .map((item) => item.semester)
        .toSorted();
    const latestClosed = closedSemesters.at(-1) ?? null;
    const parsed = parseSyncKey(lastSyncedKey);

    const baselineKey = () => {
        if (progress && progress.percent >= threshold) {
            return `${progress.semester}:${threshold}`;
        }
        if (latestClosed) {
            return `${latestClosed}:closed`;
        }
        if (lastSyncedKey) return lastSyncedKey;
        return policyTriggerId ? `trigger:${policyTriggerId}` : `periodic:${today}`;
    };

    if (policyTriggerId && lastTriggerId !== policyTriggerId) {
        return {
            shouldSync: true,
            syncKey: baselineKey(),
            includeClosing: true,
            reason: 'manual_trigger',
            triggerId: policyTriggerId
        };
    }

    if (progress && progress.percent >= threshold) {
        const alreadyCovered =
            parsed !== null &&
            (parsed.semester > progress.semester ||
                (parsed.semester === progress.semester &&
                    (parsed.isClosed || parsed.percent >= threshold)));
        if (!alreadyCovered) {
            return {
                shouldSync: true,
                syncKey: `${progress.semester}:${threshold}`,
                includeClosing: true,
                reason: 'semester_percent',
                triggerId: policyTriggerId
            };
        }
    }

    if (latestClosed) {
        const closedCovered =
            parsed !== null &&
            (parsed.semester > latestClosed ||
                (parsed.semester === latestClosed && parsed.isClosed));
        if (!closedCovered) {
            return {
                shouldSync: true,
                syncKey: `${latestClosed}:closed`,
                includeClosing: false,
                reason: 'closed_semester',
                triggerId: policyTriggerId
            };
        }
    }

    const referenceMs = nowMs ?? Date.parse(`${today}T12:00:00Z`);
    const lastAtMs = lastSyncedAt ? Date.parse(lastSyncedAt) : Number.NaN;
    if (
        Number.isFinite(lastAtMs) &&
        Number.isFinite(referenceMs) &&
        referenceMs - lastAtMs >= intervalDays * MS_PER_DAY
    ) {
        return {
            shouldSync: true,
            syncKey: baselineKey(),
            includeClosing: true,
            reason: 'periodic',
            triggerId: policyTriggerId
        };
    }

    return {
        shouldSync: false,
        syncKey: null,
        includeClosing: false,
        reason: null,
        triggerId: null
    };
}
