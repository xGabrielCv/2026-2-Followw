import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test';
import { useLayoutEffect } from 'react';

import type { SemesterCalendar } from '#/calendar';
import type { SemesterAlertConfig } from '#/queries/app-config';
import type { Classroom } from '#/queries/classrooms';
import type { OwnReview } from '#/queries/reviews';

import { appConfigQueryOptions } from '#/queries/app-config';
import { classroomsQueryOptions } from '#/queries/classrooms';
import { meQueryOptions, type UserProfile } from '#/queries/me';
import { ownReviews } from '#/queries/reviews';

import { useDom } from '../../helpers/dom';

const dom = useDom();

let SemesterAlertPrompt: typeof import('#/components/profile/SemesterAlertPrompt').SemesterAlertPrompt;
let collectCurrentProfessors: typeof import('#/components/profile/SemesterAlertPrompt').collectCurrentProfessors;
let evaluateSemesterAlert: typeof import('#/components/profile/SemesterAlertPrompt').evaluateSemesterAlert;
let restoreLayoutEffect: () => Promise<void>;

beforeAll(async () => {
    const { useIsoLayoutEffect } = await import('@base-ui/utils/useIsoLayoutEffect');
    await mock.module('@base-ui/utils/useIsoLayoutEffect', () => ({
        useIsoLayoutEffect: useLayoutEffect
    }));
    restoreLayoutEffect = async () => {
        await mock.module('@base-ui/utils/useIsoLayoutEffect', () => ({ useIsoLayoutEffect }));
    };
    ({ SemesterAlertPrompt, collectCurrentProfessors, evaluateSemesterAlert } =
        await import('#/components/profile/SemesterAlertPrompt'));
});

afterAll(() => restoreLayoutEffect?.());

afterEach(() => {
    dom.testing.cleanup();
    ownReviews.clear();
    window.localStorage.clear();
    window.sessionStorage.clear();
});

const baseAlert: SemesterAlertConfig = {
    enabled: true,
    always_on: false,
    preset: 'custom',
    title: 'Avalie seus professores do semestre',
    message: 'Ajude os próximos alunos.',
    mid_semester_enabled: true,
    mid_semester_every_n: 3,
    mid_semester_title: '50% do semestre: avalie seus professores',
    mid_semester_message: 'Como estão as aulas?',
    last_day_enabled: true,
    last_day_title: 'Último dia do semestre: avalie seus professores',
    last_day_message: 'Hoje encerra o semestre letivo.',
    first_day_enabled: true,
    first_day_title: 'Avalie seus professores do semestre anterior',
    first_day_message: 'Avalie suas turmas do semestre passado.',
    trigger_id: 'default',
    triggered_at: null
};

const sampleCalendar: SemesterCalendar = {
    semester: '2026.2',
    name: '2º Semestre de 2026',
    period: { start: '2026-08-03', end: '2026-12-20' },
    classes: { start: '2026-08-10', end: '2026-12-12', instructional_days: 100 },
    events: []
};

const classroom = (
    code: string,
    professors: Array<{ siape: number | null; name: string }>,
    semester = '2026.2'
): Classroom => ({
    id: `${semester}-${code}`,
    subject: { code, name: `Matéria ${code}` },
    semester,
    number: '01',
    schedule: '24M12',
    room: null,
    current: semester === '2026.2',
    grade: null,
    professors: professors.map((p) => ({
        ...p,
        unit: null,
        photo: null,
        url: null,
        email: null
    }))
});

const own = (id: string, subject?: string): OwnReview => ({
    id,
    token: 't'.repeat(64),
    rating: 80,
    subject
});

describe('SemesterAlertPrompt', () => {
    test('collectCurrentProfessors agrupa todas as matérias do mesmo docente e conta avaliações por matéria', () => {
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
            { '101': own('r1', 'CIC0001') }
        );
        expect(list.length).toBe(2);
        expect(list[0]).toMatchObject({
            siape: 101,
            evaluatedCount: 1,
            pendingCount: 1,
            evaluated: false,
            subjects: [
                { code: 'CIC0001', evaluated: true },
                { code: 'CIC0002', evaluated: false }
            ]
        });
        expect(list[1]).toMatchObject({
            siape: 202,
            evaluatedCount: 0,
            pendingCount: 1,
            evaluated: false
        });
    });

    test('exibe alerta manual apenas enquanto houver pendência e respeita trigger_id', () => {
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
            reviews: { '101': own('r1', 'CIC0001') },
            dismissed: {},
            closedInSession: false,
            midOpenCount: 2
        });
        expect(open.show).toBe(true);
        expect(open.mode).toBe('manual');
        expect(open.pendingCount).toBe(1);

        const done = evaluateSemesterAlert({
            alert: triggered,
            progress: { semester: '2026.2', percent: 20 },
            classrooms,
            reviews: { '101': own('r1', 'CIC0001'), '202': own('r2', 'CIC0001') },
            dismissed: {},
            closedInSession: false,
            midOpenCount: 2
        });
        expect(done.show).toBe(false);

        const dismissedSame = evaluateSemesterAlert({
            alert: triggered,
            progress: { semester: '2026.2', percent: 20 },
            classrooms,
            reviews: {},
            dismissed: { triggerId: 'campanha-1' },
            closedInSession: false,
            midOpenCount: 1
        });
        expect(dismissedSame.show).toBe(false);
    });

    test('50% do semestre usa cadência determinística a cada N aberturas e respeita always_on', () => {
        const classrooms = [classroom('CIC0001', [{ siape: 101, name: 'Ana' }])];

        expect(
            evaluateSemesterAlert({
                alert: { ...baseAlert, enabled: false, always_on: true },
                progress: undefined,
                classrooms: [],
                reviews: {},
                dismissed: { triggerId: 'default' },
                closedInSession: false,
                midOpenCount: 2
            }).show
        ).toBe(true);

        // Antes dos 50% não abre
        expect(
            evaluateSemesterAlert({
                alert: baseAlert,
                progress: { semester: '2026.2', percent: 49 },
                classrooms,
                reviews: {},
                dismissed: {},
                closedInSession: false,
                midOpenCount: 1
            }).show
        ).toBe(false);

        // Abertura #1, #2, #3, #4 com every_n = 3 -> mostra em #1 e #4
        expect(
            evaluateSemesterAlert({
                alert: baseAlert,
                progress: { semester: '2026.2', percent: 50 },
                classrooms,
                reviews: {},
                dismissed: {},
                closedInSession: false,
                midOpenCount: 1
            }).mode
        ).toBe('mid');

        expect(
            evaluateSemesterAlert({
                alert: baseAlert,
                progress: { semester: '2026.2', percent: 50 },
                classrooms,
                reviews: {},
                dismissed: {},
                closedInSession: false,
                midOpenCount: 2
            }).show
        ).toBe(false);

        expect(
            evaluateSemesterAlert({
                alert: baseAlert,
                progress: { semester: '2026.2', percent: 50 },
                classrooms,
                reviews: {},
                dismissed: {},
                closedInSession: false,
                midOpenCount: 4
            }).mode
        ).toBe('mid');
    });

    test('dispara versão de último dia e de primeiro dia usando docentes do semestre anterior', () => {
        const current = [classroom('CIC0001', [{ siape: 101, name: 'Ana' }], '2026.2')];
        const prev = [classroom('MAT0025', [{ siape: 303, name: 'Carlos' }], '2026.1')];

        const lastDay = evaluateSemesterAlert({
            alert: baseAlert,
            progress: { semester: '2026.2', percent: 100 },
            currentCalendar: sampleCalendar,
            today: '2026-12-12',
            classrooms: current,
            reviews: {},
            dismissed: {},
            closedInSession: false
        });
        expect(lastDay.show).toBe(true);
        expect(lastDay.mode).toBe('last_day');
        expect(lastDay.title).toBe(baseAlert.last_day_title);
        expect(lastDay.professors.map((p) => p.siape)).toEqual([101]);

        const firstDay = evaluateSemesterAlert({
            alert: baseAlert,
            progress: { semester: '2026.2', percent: 1 },
            currentCalendar: sampleCalendar,
            today: '2026-08-10',
            classrooms: current,
            previousClassrooms: prev,
            reviews: {},
            dismissed: {},
            closedInSession: false
        });
        expect(firstDay.show).toBe(true);
        expect(firstDay.mode).toBe('first_day');
        expect(firstDay.title).toBe(baseAlert.first_day_title);
        expect(firstDay.periodLabel).toBe('do semestre anterior');
        expect(firstDay.professors.map((p) => p.siape)).toEqual([303]);
    });

    test('docente com várias matérias aparece uma vez e abre diálogo para escolher a matéria', async () => {
        const client = new QueryClient({
            defaultOptions: { queries: { retry: false, staleTime: Infinity } }
        });
        const profile: UserProfile = {
            registration: '251000000',
            name: 'Estudante',
            bio: null,
            course: null,
            entry_semester: '2025.1',
            unit: null,
            photo: null,
            integralization: null,
            workload: null,
            period_max_workload: null,
            ira: null,
            mp: null,
            level: 'Graduação'
        };
        client.setQueryData(meQueryOptions.queryKey, profile);
        client.setQueryData(appConfigQueryOptions.queryKey, {
            menu: {},
            links: { automatricula: null, monitor: null },
            flags: {},
            calendar: {},
            alert: { ...baseAlert, always_on: true }
        });
        client.setQueryData(classroomsQueryOptions.queryKey, [
            classroom('FGA0030', [{ siape: 101, name: 'MAURICIO SERRANO' }]),
            classroom('FGA0124', [{ siape: 101, name: 'MAURICIO SERRANO' }])
        ]);

        const page = dom.testing.render(
            <QueryClientProvider client={client}>
                <SemesterAlertPrompt />
            </QueryClientProvider>
        );

        await dom.testing.waitFor(() => expect(page.getByText(/0\/2 avaliadas/)).toBeDefined());
        const profButton = page.getByRole('button', { name: /MAURICIO SERRANO/ });
        expect(profButton.textContent).toContain('FGA0030');
        expect(profButton.textContent).toContain('FGA0124');

        dom.testing.fireEvent.click(profButton);
        await dom.testing.waitFor(() =>
            expect(page.getByText('Escolha a matéria para avaliar')).toBeDefined()
        );
        expect(page.getAllByText('FGA0030').length).toBeGreaterThan(0);
        expect(page.getAllByText('FGA0124').length).toBeGreaterThan(0);
    });
});
