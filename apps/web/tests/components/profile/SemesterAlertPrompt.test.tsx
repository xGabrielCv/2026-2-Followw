import { describe, expect, test } from 'bun:test';

import type { SemesterAlertConfig } from '#/queries/app-config';
import type { Classroom } from '#/queries/classrooms';

import {
    collectCurrentProfessors,
    evaluateSemesterAlert
} from '#/components/profile/SemesterAlertPrompt';

const baseAlert: SemesterAlertConfig = {
    enabled: true,
    always_on: false,
    preset: 'custom',
    title: 'Avalie seus professores',
    message: 'Ajude os próximos alunos.',
    mid_semester_enabled: true,
    mid_semester_chance: 50,
    mid_semester_title: 'Metade do semestre',
    mid_semester_message: 'Como estão as aulas?',
    trigger_id: 'default',
    triggered_at: null
};

const classroom = (
    code: string,
    professors: Array<{ siape: number | null; name: string }>
): Classroom => ({
    id: code,
    subject: { code, name: `Matéria ${code}` },
    semester: '2026.2',
    number: '01',
    schedule: '24M12',
    room: null,
    current: true,
    grade: null,
    professors: professors.map((p) => ({
        ...p,
        unit: null,
        photo: null,
        url: null,
        email: null
    }))
});

describe('SemesterAlertPrompt', () => {
    test('collectCurrentProfessors deduplica docentes com SIAPE e marca status local', () => {
        const list = collectCurrentProfessors(
            [
                classroom('CIC0001', [
                    { siape: 101, name: 'Ana' },
                    { siape: null, name: 'Sem Siape' }
                ]),
                classroom('CIC0002', [
                    { siape: 101, name: 'Ana' },
                    { siape: 202, name: 'Bruno' }
                ])
            ],
            { '101': { id: 'r1' } }
        );
        expect(list.map((p) => ({ siape: p.siape, evaluated: p.evaluated }))).toEqual([
            { siape: 101, evaluated: true },
            { siape: 202, evaluated: false }
        ]);
    });

    test('exibe alerta disparado apenas enquanto houver docente pendente e respeita dispensa por trigger_id', () => {
        const classrooms = [
            classroom('CIC0001', [
                { siape: 101, name: 'Ana' },
                { siape: 202, name: 'Bruno' }
            ])
        ];
        const triggered: SemesterAlertConfig = {
            ...baseAlert,
            trigger_id: 'campanha-1',
            triggered_at: '2026-11-10T10:00:00Z'
        };

        const open = evaluateSemesterAlert({
            alert: triggered,
            progress: { semester: '2026.2', percent: 20 },
            classrooms,
            reviews: { '101': {} },
            dismissed: {},
            closedInSession: false,
            midRoll: 0.99
        });
        expect(open.show).toBe(true);
        expect(open.mode).toBe('manual');
        expect(open.pendingCount).toBe(1);

        // Quando todos os professores atuais já foram avaliados, deixa de incomodar
        const done = evaluateSemesterAlert({
            alert: triggered,
            progress: { semester: '2026.2', percent: 20 },
            classrooms,
            reviews: { '101': {}, '202': {} },
            dismissed: {},
            closedInSession: false,
            midRoll: 0.99
        });
        expect(done.show).toBe(false);

        // "Não mostrar novamente" suprime o mesmo trigger_id e reabre quando o admin dispara novo
        const dismissedSame = evaluateSemesterAlert({
            alert: triggered,
            progress: { semester: '2026.2', percent: 20 },
            classrooms,
            reviews: {},
            dismissed: { triggerId: 'campanha-1' },
            closedInSession: false,
            midRoll: 0.99
        });
        expect(dismissedSame.show).toBe(false);

        const nextCampaign = evaluateSemesterAlert({
            alert: { ...triggered, trigger_id: 'campanha-2' },
            progress: { semester: '2026.2', percent: 20 },
            classrooms,
            reviews: {},
            dismissed: { triggerId: 'campanha-1' },
            closedInSession: false,
            midRoll: 0.99
        });
        expect(nextCampaign.show).toBe(true);
    });

    test('modo teste always_on força exibição e metade do semestre usa 50% + probabilidade', () => {
        const classrooms = [classroom('CIC0001', [{ siape: 101, name: 'Ana' }])];

        expect(
            evaluateSemesterAlert({
                alert: { ...baseAlert, enabled: false, always_on: true },
                progress: undefined,
                classrooms: [],
                reviews: {},
                dismissed: { triggerId: 'default' },
                closedInSession: false,
                midRoll: 0.99
            }).show
        ).toBe(true);

        expect(
            evaluateSemesterAlert({
                alert: baseAlert,
                progress: { semester: '2026.2', percent: 49 },
                classrooms,
                reviews: {},
                dismissed: {},
                closedInSession: false,
                midRoll: 0.1
            }).show
        ).toBe(false);

        const mid = evaluateSemesterAlert({
            alert: baseAlert,
            progress: { semester: '2026.2', percent: 50 },
            classrooms,
            reviews: {},
            dismissed: {},
            closedInSession: false,
            midRoll: 0.25
        });
        expect(mid.show).toBe(true);
        expect(mid.mode).toBe('mid');

        expect(
            evaluateSemesterAlert({
                alert: baseAlert,
                progress: { semester: '2026.2', percent: 50 },
                classrooms,
                reviews: {},
                dismissed: { midDismissedSemester: '2026.2' },
                closedInSession: false,
                midRoll: 0.1
            }).show
        ).toBe(false);
    });
});
