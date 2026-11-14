import type { UserProfile } from '#/queries/me';

export function userProfile(overrides: Partial<UserProfile> = {}): UserProfile {
    return {
        name: 'Fulano',
        registration: '251000000',
        photo: null,
        email: null,
        bio: null,
        unit: { id: 673, code: 'FCTE', name: 'CAMPUS UNB GAMA' },
        course: { id: 1, name: 'Engenharia de Software', shift: 'DIURNO' },
        entry_semester: null,
        curriculum_subject_codes: null,
        integralization: null,
        workload: null,
        period_max_workload: null,
        ira: null,
        mp: null,
        level: 'Graduação',
        ...overrides
    };
}
