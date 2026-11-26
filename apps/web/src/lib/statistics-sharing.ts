import type { SemesterCalendar } from '#/calendar';
import type { Classroom } from '#/queries/classrooms';

import { semesterProgress } from '#/calendar';

export const AUTO_SHARE_SEMESTER_PERCENT = 98;

export interface AutoReshareDecision {
    shouldSync: boolean;
    syncKey: string | null;
    includeClosing: boolean;
}

/**
 * Decide se o app deve reenviar anonimamente os índices das turmas do aluno que ativou
 * "Compartilhar índices das minhas turmas":
 * - Nunca compartilha se `enabled` for falso;
 * - Reenvia automaticamente quando o semestre atual atinge >= 98% de conclusão (uma vez por semestre);
 * - Reenvia automaticamente quando surge um semestre encerrado mais recente que ainda não foi sincronizado.
 */
export function evaluateAutoReshare({
    enabled,
    classrooms,
    today,
    customCalendar,
    lastSyncedKey
}: {
    enabled: boolean;
    classrooms: readonly Pick<Classroom, 'semester' | 'current'>[] | undefined;
    today: string;
    customCalendar?: Record<string, SemesterCalendar>;
    lastSyncedKey?: string | null;
}): AutoReshareDecision {
    if (!enabled) {
        return { shouldSync: false, syncKey: null, includeClosing: false };
    }

    const progress = semesterProgress(today, customCalendar);
    if (progress && progress.percent >= AUTO_SHARE_SEMESTER_PERCENT) {
        const milestoneKey = `${progress.semester}:98`;
        if (lastSyncedKey !== milestoneKey) {
            return { shouldSync: true, syncKey: milestoneKey, includeClosing: true };
        }
    }

    const closedSemesters = (classrooms ?? [])
        .filter((item) => !item.current)
        .map((item) => item.semester)
        .toSorted();
    const latestClosed = closedSemesters.at(-1);
    if (latestClosed) {
        const closedKey = `${latestClosed}:closed`;
        const lastSemester = lastSyncedKey?.split(':')[0];
        if (lastSyncedKey !== closedKey && (!lastSemester || lastSemester < latestClosed)) {
            return { shouldSync: true, syncKey: closedKey, includeClosing: false };
        }
    }

    return { shouldSync: false, syncKey: null, includeClosing: false };
}
