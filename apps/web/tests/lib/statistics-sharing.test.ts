import { describe, expect, test } from 'bun:test';

import type { SemesterCalendar } from '#/calendar';

import { evaluateAutoReshare } from '#/lib/statistics-sharing';

const CALENDAR: Record<string, SemesterCalendar> = {
    '2026.2': {
        semester: '2026.2',
        name: '2º Semestre de 2026',
        period: { start: '2026-08-10', end: '2026-12-15' },
        classes: { start: '2026-08-10', end: '2026-12-10', instructional_days: 100 },
        events: []
    }
};

describe('reenvio automático das estatísticas das turmas', () => {
    test('nunca compartilha quando o aluno desativou a opção', () => {
        const decision = evaluateAutoReshare({
            enabled: false,
            classrooms: [{ semester: '2026.1', current: false }],
            today: '2026-12-09',
            customCalendar: CALENDAR,
            lastSyncedKey: null
        });
        expect(decision).toEqual({ shouldSync: false, syncKey: null, includeClosing: false });
    });

    test('dispara automaticamente ao atingir 98% do semestre atual com includeClosing', () => {
        // 123 dias de 2026-08-10 a 2026-12-10; em 2026-12-09 passou 122/123 (~99%)
        const first = evaluateAutoReshare({
            enabled: true,
            classrooms: [
                { semester: '2026.1', current: false },
                { semester: '2026.2', current: true }
            ],
            today: '2026-12-09',
            customCalendar: CALENDAR,
            lastSyncedKey: '2026.1:closed'
        });
        expect(first).toEqual({
            shouldSync: true,
            syncKey: '2026.2:98',
            includeClosing: true
        });

        // Após sincronizar nos 98%, não repete no mesmo semestre
        const second = evaluateAutoReshare({
            enabled: true,
            classrooms: [
                { semester: '2026.1', current: false },
                { semester: '2026.2', current: true }
            ],
            today: '2026-12-10',
            customCalendar: CALENDAR,
            lastSyncedKey: '2026.2:98'
        });
        expect(second.shouldSync).toBe(false);
    });

    test('no meio do semestre já sincronizado não repete, mas reenvia quando um novo semestre fecha', () => {
        const mid = evaluateAutoReshare({
            enabled: true,
            classrooms: [
                { semester: '2026.1', current: false },
                { semester: '2026.2', current: true }
            ],
            today: '2026-10-01',
            customCalendar: CALENDAR,
            lastSyncedKey: '2026.1:closed'
        });
        expect(mid.shouldSync).toBe(false);

        const nextClosed = evaluateAutoReshare({
            enabled: true,
            classrooms: [
                { semester: '2026.1', current: false },
                { semester: '2026.2', current: false }
            ],
            today: '2027-01-10',
            customCalendar: CALENDAR,
            lastSyncedKey: '2026.1:closed'
        });
        expect(nextClosed).toEqual({
            shouldSync: true,
            syncKey: '2026.2:closed',
            includeClosing: false
        });
    });
});
