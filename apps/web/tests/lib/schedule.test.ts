import { describe, expect, test } from 'bun:test';

import {
    addDays,
    classesOn,
    dayOverview,
    describeSchedule,
    formatDuration,
    nextDays,
    nowInBrasilia,
    parseSchedule,
    weekDays,
    weeklyMinutes
} from '#/lib/schedule.ts';

describe('parseSchedule', () => {
    test('expande dias e junta horários seguidos', () => {
        expect(parseSchedule('35T23')).toEqual([
            { weekday: 2, start: '14:00', end: '15:50' },
            { weekday: 4, start: '14:00', end: '15:50' }
        ]);
    });

    test('aceita mais de um bloco e ordena por dia', () => {
        expect(parseSchedule('4M12 2N34')).toEqual([
            { weekday: 1, start: '20:50', end: '22:30' },
            { weekday: 3, start: '08:00', end: '09:50' }
        ]);
    });

    test('junta blocos colados entre turnos', () => {
        expect(parseSchedule('35M5 35T1')).toEqual([
            { weekday: 2, start: '12:00', end: '13:50' },
            { weekday: 4, start: '12:00', end: '13:50' }
        ]);
        expect(parseSchedule('24T6 24N1')).toEqual([
            { weekday: 1, start: '18:00', end: '19:50' },
            { weekday: 3, start: '18:00', end: '19:50' }
        ]);
        expect(parseSchedule('2M5 3T1')).toHaveLength(2);
        expect(parseSchedule('2T6')).toEqual([{ weekday: 1, start: '18:00', end: '18:55' }]);
        expect(parseSchedule('2T4 2T5')).toEqual([{ weekday: 1, start: '16:00', end: '17:50' }]);
        expect(parseSchedule('2T3 2T4')).toHaveLength(2);
    });

    test('ignora código vazio ou inválido', () => {
        expect(parseSchedule(null)).toEqual([]);
        expect(parseSchedule('99Z9')).toEqual([]);
    });
});

describe('describeSchedule', () => {
    test('agrupa os dias com o mesmo horário', () => {
        expect(describeSchedule('35M34')).toBe('Ter, Qui · 10:00–11:50');
        expect(describeSchedule('35M5 35T1')).toBe('Ter, Qui · 12:00–13:50');
        expect(describeSchedule('24T6 24N1')).toBe('Seg, Qua · 18:00–19:50');
    });

    test('devolve o código quando não entende', () => {
        expect(describeSchedule('A DEFINIR')).toBe('A DEFINIR');
        expect(describeSchedule(null)).toBeUndefined();
    });
});

describe('classesOn', () => {
    const turmas = [
        { name: 'Cálculo', schedule: '246M12' },
        { name: 'Software', schedule: '24T23' },
        { name: 'Física', schedule: '35N12' }
    ];

    test('filtra o dia e marca em andamento e próxima', () => {
        const aulas = classesOn(turmas, 1, '09:00');
        expect(aulas.map((a) => [a.item.name, a.status])).toEqual([
            ['Cálculo', 'in_progress'],
            ['Software', 'next']
        ]);
    });

    test('sem horário, nenhuma aula recebe status', () => {
        expect(classesOn(turmas, 5).map((a) => a.status)).toEqual(['normal']);
    });
});

test('nowInBrasilia usa o fuso de Brasília', () => {
    expect(nowInBrasilia(new Date('2026-09-27T02:30:00Z'))).toEqual({
        date: '2026-09-26',
        weekday: 6,
        time: '23:30'
    });
});

test('nextDays atravessa o fim do mês', () => {
    expect(nextDays('2026-09-29', 3)).toEqual([
        { date: '2026-09-29', weekday: 2 },
        { date: '2026-09-30', weekday: 3 },
        { date: '2026-10-01', weekday: 4 }
    ]);
});

const dates = (date: string) => weekDays(date).map((d) => d.date);

describe('weekDays', () => {
    test('vai de segunda a sábado da semana, atravessando o mês', () => {
        expect(dates('2026-09-30')).toEqual([
            '2026-09-28',
            '2026-09-29',
            '2026-09-30',
            '2026-10-01',
            '2026-10-02',
            '2026-10-03'
        ]);
        expect(weekDays('2026-09-26').map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    test('no domingo, mostra a semana que começa', () => {
        expect(dates('2026-09-27')[0]).toBe('2026-09-28');
    });

    test('com count=7 vai de segunda a domingo da semana', () => {
        expect(weekDays('2026-09-30', 7).map((d) => d.date)).toEqual([
            '2026-09-28',
            '2026-09-29',
            '2026-09-30',
            '2026-10-01',
            '2026-10-02',
            '2026-10-03',
            '2026-10-04'
        ]);
        expect(weekDays('2026-09-26', 7).map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    });

    test('no domingo com count=7, mostra a semana que termina nele', () => {
        const days = weekDays('2026-09-27', 7);
        expect(days[0].date).toBe('2026-09-21');
        expect(days.at(-1)?.date).toBe('2026-09-27');
        expect(days.at(-1)?.weekday).toBe(0);
    });
});

describe('addDays', () => {
    test('soma e subtrai dias atravessando meses', () => {
        expect(addDays('2026-09-28', 7)).toBe('2026-10-05');
        expect(addDays('2026-10-05', -7)).toBe('2026-09-28');
    });
});

describe('dayOverview', () => {
    const items = [
        { id: 'a', schedule: '2M12' },
        { id: 'b', schedule: '2M34' },
        { id: 'c', schedule: '2T45' }
    ];

    test('soma o tempo em sala e marca só intervalos longos', () => {
        const overview = dayOverview(classesOn(items, 1));
        expect(overview).toMatchObject({
            count: 3,
            minutes: 330,
            start: '08:00',
            end: '17:50',
            finished: false
        });
        // 10 minutos entre a e b não contam; de 11:50 a 16:00 sim
        expect(overview.gaps).toEqual([undefined, undefined, 250]);
    });

    test('conta os minutos até a próxima aula e o fim do dia', () => {
        expect(dayOverview(classesOn(items, 1, '09:00'), '09:00').nextIn).toBe(60);
        expect(dayOverview(classesOn(items, 1, '18:00'), '18:00')).toMatchObject({
            nextIn: undefined,
            finished: true
        });
    });

    test('dia vazio não termina nem tem horários', () => {
        expect(dayOverview([], '10:00')).toMatchObject({ count: 0, minutes: 0, finished: false });
    });
});

describe('formatDuration', () => {
    test.each([
        [50, '50 min'],
        [60, '1h'],
        [70, '1h10'],
        [125, '2h05']
    ])('%p minutos viram %p', (minutes, text) => {
        expect(formatDuration(minutes)).toBe(text);
    });
});

test('weeklyMinutes soma os horários de todas as turmas', () => {
    expect(weeklyMinutes([{ schedule: '35T23' }, { schedule: '2N12' }, { schedule: null }])).toBe(
        2 * 110 + 100
    );
});
