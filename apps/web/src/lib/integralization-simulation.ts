import type { Classroom } from '#/queries/classrooms';
import type { UserProfile } from '#/queries/me';

import { curriculumProgress } from '#/lib/profile';
import { approvedCodes } from '#/queries/subjects';

export type Outcome = 'pending' | 'approved' | 'failed' | 'withdrawn';
export type Category = 'mandatory' | 'optional' | 'complementary' | 'free' | 'unknown';
export type Scenario = Record<string, { outcome: Outcome; category: Category }>;

export function integralizationSubjects(classrooms: Classroom[], semester: string) {
    const approved = approvedCodes(classrooms);
    const unique = new Map<string, Classroom>();
    for (const item of classrooms) {
        if (
            item.semester !== semester ||
            !item.current ||
            approved.has(item.subject.code) ||
            (item.status && item.status !== 'cursando')
        )
            continue;
        if (!unique.has(item.subject.code)) unique.set(item.subject.code, item);
    }
    return [...unique.values()];
}

export function simulateIntegralization(
    user: Pick<UserProfile, 'workload' | 'integralization'>,
    items: Classroom[],
    scenario: Scenario
) {
    const progress = curriculumProgress(user.workload);
    if (!progress?.total || !user.workload) return null;
    const official = user.integralization;
    const current =
        official != null && Number.isFinite(official) && official >= 0 && official <= 100
            ? official
            : (progress.completed / progress.total) * 100;
    const approved = { mandatory: 0, optional: 0, complementary: 0 };
    const uncertain: string[] = [];
    const seen = new Set<string>();
    for (const item of items) {
        const code = item.subject.code;
        if (seen.has(code)) continue;
        seen.add(code);
        const choice = scenario[code];
        if (choice?.outcome !== 'approved') continue;
        const category = choice.category;
        const hours = item.subject.hours;
        if (category === 'free') continue;
        if (category === 'unknown' || hours == null || !Number.isFinite(hours) || hours <= 0) {
            uncertain.push(item.subject.name);
            continue;
        }
        approved[category] += hours;
    }
    const credited = {
        mandatory: Math.min(approved.mandatory, user.workload.pending_mandatory),
        optional: Math.min(approved.optional, user.workload.pending_optional),
        complementary: Math.min(approved.complementary, user.workload.pending_complementary)
    };
    const added = credited.mandatory + credited.optional + credited.complementary;
    return {
        current,
        future: Math.min(100, current + (added / progress.total) * 100),
        added,
        credited,
        uncertain,
        total: progress.total
    };
}
