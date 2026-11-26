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
    },
    '2028.1': {
        semester: '2028.1',
        name: '1º Semestre de 2028',
        period: { start: '2028-03-06', end: '2028-07-12' },
        classes: { start: '2028-03-06', end: '2028-07-08', instructional_days: 100 },
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
            policy: { semester_percent: 80, interval_days: 30, trigger_id: 'forcado' },
            lastSyncedKey: null,
            lastSyncedAt: '2025-01-01T00:00:00Z'
        });
        expect(decision.shouldSync).toBe(false);
    });

    test('dispara automaticamente ao atingir o percentual configurável do semestre', () => {
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
            includeClosing: true,
            reason: 'semester_percent',
            triggerId: null
        });

        // Após sincronizar nos 98%, não repete enquanto 2026.2 ainda estiver em andamento
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

        // Percentual menor configurado no admin (ex.: 90%) dispara mais cedo no semestre
        const custom90 = evaluateAutoReshare({
            enabled: true,
            classrooms: [
                { semester: '2026.1', current: false },
                { semester: '2026.2', current: true }
            ],
            today: '2026-12-01', // ~92%
            customCalendar: CALENDAR,
            policy: { semester_percent: 90, interval_days: 180 },
            lastSyncedKey: '2026.1:closed'
        });
        expect(custom90.shouldSync).toBe(true);
        expect(custom90.syncKey).toBe('2026.2:90');
        expect(custom90.reason).toBe('semester_percent');
    });

    test('recupera semestre perdido fora da janela 90–100% e consolidação após 98%', () => {
        // Caso 1: aluno não abriu o app durante o fim de 2026.2 e só entrou em 2027.1
        const missedWindow = evaluateAutoReshare({
            enabled: true,
            classrooms: [
                { semester: '2026.1', current: false },
                { semester: '2026.2', current: false },
                { semester: '2027.1', current: true }
            ],
            today: '2027-04-10',
            customCalendar: CALENDAR,
            lastSyncedKey: '2026.1:closed',
            lastSyncedAt: '2026-08-15T12:00:00Z'
        });
        expect(missedWindow).toEqual({
            shouldSync: true,
            syncKey: '2026.2:closed',
            includeClosing: false,
            reason: 'closed_semester',
            triggerId: null
        });

        // Caso 2: aluno sincronizou em 2026.2:98 mas algum docente consolidou depois do fechamento
        const afterClose = evaluateAutoReshare({
            enabled: true,
            classrooms: [
                { semester: '2026.1', current: false },
                { semester: '2026.2', current: false }
            ],
            today: '2027-01-10',
            customCalendar: CALENDAR,
            lastSyncedKey: '2026.2:98',
            lastSyncedAt: '2026-12-09T12:00:00Z'
        });
        expect(afterClose).toEqual({
            shouldSync: true,
            syncKey: '2026.2:closed',
            includeClosing: false,
            reason: 'closed_semester',
            triggerId: null
        });

        // Depois de sincronizar 2026.2:closed, não repete no meio do semestre seguinte
        const settled = evaluateAutoReshare({
            enabled: true,
            classrooms: [
                { semester: '2026.1', current: false },
                { semester: '2026.2', current: false },
                { semester: '2027.1', current: true }
            ],
            today: '2027-04-10',
            customCalendar: CALENDAR,
            lastSyncedKey: '2026.2:closed',
            lastSyncedAt: '2027-01-10T12:00:00Z'
        });
        expect(settled.shouldSync).toBe(false);
    });

    test('disparo global manual pelo admin força reenvio único por trigger_id', () => {
        const triggered = evaluateAutoReshare({
            enabled: true,
            classrooms: [
                { semester: '2026.1', current: false },
                { semester: '2026.2', current: true }
            ],
            today: '2026-10-01',
            customCalendar: CALENDAR,
            policy: { semester_percent: 98, interval_days: 180, trigger_id: 'abc123def456' },
            lastSyncedKey: '2026.1:closed',
            lastSyncedAt: '2026-09-25T12:00:00Z',
            lastTriggerId: null
        });
        expect(triggered).toEqual({
            shouldSync: true,
            syncKey: '2026.1:closed',
            includeClosing: true,
            reason: 'manual_trigger',
            triggerId: 'abc123def456'
        });

        // Após atender este trigger_id, não repete
        const alreadyDone = evaluateAutoReshare({
            enabled: true,
            classrooms: [
                { semester: '2026.1', current: false },
                { semester: '2026.2', current: true }
            ],
            today: '2026-10-02',
            customCalendar: CALENDAR,
            policy: { semester_percent: 98, interval_days: 180, trigger_id: 'abc123def456' },
            lastSyncedKey: '2026.1:closed',
            lastSyncedAt: '2026-10-01T12:00:00Z',
            lastTriggerId: 'abc123def456'
        });
        expect(alreadyDone.shouldSync).toBe(false);
    });

    test('intervalo periódico de segurança dispara mesmo sem calendário e funciona em anos futuros (2028+)', () => {
        const periodic = evaluateAutoReshare({
            enabled: true,
            classrooms: [{ semester: '2027.2', current: false }],
            today: '2028-06-20',
            customCalendar: {},
            policy: { semester_percent: 98, interval_days: 180 },
            lastSyncedKey: '2027.2:closed',
            lastSyncedAt: '2027-12-01T00:00:00Z'
        });
        expect(periodic.shouldSync).toBe(true);
        expect(periodic.reason).toBe('periodic');
        expect(periodic.includeClosing).toBe(true);

        const future2028 = evaluateAutoReshare({
            enabled: true,
            classrooms: [
                { semester: '2027.2', current: false },
                { semester: '2028.1', current: true }
            ],
            today: '2028-07-07',
            customCalendar: CALENDAR,
            policy: { semester_percent: 98, interval_days: 180 },
            lastSyncedKey: '2027.2:closed',
            lastSyncedAt: '2028-03-10T00:00:00Z'
        });
        expect(future2028.shouldSync).toBe(true);
        expect(future2028.syncKey).toBe('2028.1:98');
        expect(future2028.reason).toBe('semester_percent');
    });
});
