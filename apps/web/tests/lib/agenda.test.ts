import { describe, expect, test } from 'bun:test';

import type { CalendarEntry } from '#/queries/events';

import {
    SUBJECT_COLORS,
    academicEventsOn,
    addMonths,
    agendaFor,
    automaticColorIndex,
    dueReminders,
    entriesOn,
    formatClock,
    monthLabel,
    monthWeeks,
    relativeDays,
    subjectPalette
} from '#/lib/agenda';

const entry = (fields: Partial<CalendarEntry>): CalendarEntry => ({
    id: fields.title ?? 'x',
    date: '2026-11-20',
    title: 'Prova',
    kind: 'prova',
    time: null,
    subject_code: null,
    notes: null,
    remind_days: null,
    ...fields
});

test('subjectPalette dá cores diferentes às matérias do aluno e a mesma para o mesmo código', () => {
    const colorOf = subjectPalette(['FGA0030', 'FGA0124', 'FGA0161', 'FGA0030']);
    const colors = ['FGA0030', 'FGA0124', 'FGA0161'].map((code) => colorOf(code).text);
    expect(new Set(colors).size).toBe(3);
    expect(colorOf('FGA0030')).toBe(colorOf('FGA0030'));
    // fora da lista ainda tem cor estável
    expect(colorOf('MAT0025')).toBe(colorOf('MAT0025'));
});

test('formatClock tira os segundos e o zero à esquerda', () => {
    expect(formatClock('08:00:00')).toBe('8:00');
    expect(formatClock('14:50')).toBe('14:50');
});

describe('lembretes', () => {
    const entries = [
        entry({ title: 'Prova 2', date: '2026-11-20', remind_days: 3 }),
        entry({ title: 'Entrega', date: '2026-11-18', remind_days: 0 }),
        entry({ title: 'Sem lembrete', date: '2026-11-18' }),
        entry({ title: 'Passada', date: '2026-11-10', remind_days: 7 }),
        entry({ title: 'Longe', date: '2026-12-20', remind_days: 7 })
    ];
    const titles = (today: string) => dueReminders(entries, today).map((item) => item.title);

    test('aparecem da data do lembrete até o dia, do mais próximo ao mais distante', () => {
        expect(titles('2026-11-16')).toEqual([]);
        expect(titles('2026-11-17')).toEqual(['Prova 2']);
        expect(titles('2026-11-18')).toEqual(['Entrega', 'Prova 2']);
        expect(titles('2026-11-21')).toEqual([]);
    });

    test('relativeDays fala hoje, amanhã ou em n dias', () => {
        expect([0, 1, 5].map(relativeDays)).toEqual(['Hoje', 'Amanhã', 'Em 5 dias']);
    });

    test('entriesOn ordena os do dia pelo horário, os sem horário antes', () => {
        const day = [
            entry({ title: 'Tarde', date: '2026-11-18', time: '14:00:00' }),
            entry({ title: 'Dia todo', date: '2026-11-18' }),
            entry({ title: 'Manhã', date: '2026-11-18', time: '08:00:00' })
        ];
        expect(entriesOn(day, '2026-11-18').map((item) => item.title)).toEqual([
            'Dia todo',
            'Manhã',
            'Tarde'
        ]);
    });
});

describe('mês', () => {
    test('monthWeeks cobre o mês de domingo a sábado', () => {
        const weeks = monthWeeks('2026-11');
        expect(weeks).toHaveLength(5);
        expect(weeks[0][0]).toBe('2026-11-01');
        expect(weeks.at(-1)?.at(-1)).toBe('2026-12-05');
        // outubro de 2026 começa numa quinta
        expect(monthWeeks('2026-10')[0][0]).toBe('2026-09-27');
    });

    test('addMonths atravessa o ano e monthLabel escreve por extenso', () => {
        expect(addMonths('2026-12', 1)).toBe('2027-01');
        expect(addMonths('2026-01', -1)).toBe('2025-12');
        expect(monthLabel('2026-11')).toBe('Novembro de 2026');
    });
});

test('academicEventsOn traz primeiro o feriado do dia', () => {
    const events = academicEventsOn('2026-10-12');
    expect(events.map((event) => event.name)).toContain('Nossa Senhora Aparecida');
    expect(events[0].category).toBe('holiday');
});

test('academicEventsOn marca só o começo e o fim dos eventos longos', () => {
    const long = academicEventsOn('2026-07-24').find(
        (event) => event.start_date === '2026-07-24' && event.end_date > '2026-08-05'
    );
    if (!long) return;
    expect(academicEventsOn(long.end_date).some((event) => event.name === long.name)).toBe(true);
    expect(academicEventsOn('2026-07-30').some((event) => event.name === long.name)).toBe(false);
});

const turma = (code: string, semester: string, schedule = '2M12') => ({
    id: `${code}-${semester}`,
    subject: { code, name: code },
    room: 'S1',
    schedule,
    semester
});

describe('agenda gerada das turmas', () => {
    const classrooms = [turma('FGA0030', '2026.2'), turma('FGA0124', '2026.2', '4T23')];
    const planned = [turma('FGA0304', '2027.1')];

    test('usa as turmas do semestre do dia, sem cadastro manual', () => {
        // 9/11/2026 é segunda: só a de segunda aparece
        const { classes, preview } = agendaFor('2026-11-09', classrooms, planned);
        expect(classes.map(({ item }) => item.subject.code)).toEqual(['FGA0030']);
        expect(preview).toBe(false);
    });

    test('no próximo semestre, sem turmas do SIGAA, mostra a grade planejada como prévia', () => {
        const { classes, preview } = agendaFor('2027-03-15', classrooms, planned);
        expect(classes.map(({ item }) => item.subject.code)).toEqual(['FGA0304']);
        expect(preview).toBe(true);
    });

    test('com turmas reais do semestre, a prévia some', () => {
        const real = [...classrooms, turma('FGA0099', '2027.1')];
        const { classes, preview } = agendaFor('2027-03-15', real, planned);
        expect(classes.map(({ item }) => item.subject.code)).toEqual(['FGA0099']);
        expect(preview).toBe(false);
    });

    test('feriado e férias não têm aula', () => {
        expect(agendaFor('2026-10-12', classrooms).classes).toEqual([]);
        expect(agendaFor('2027-01-04', classrooms).classes).toEqual([]);
    });
});

test('a cor escolhida pelo aluno vence a automática, que segue a ordem dos códigos', () => {
    const codes = ['FGA0124', 'FGA0030'];
    expect(automaticColorIndex(codes, 'FGA0030')).toBe(0);
    expect(automaticColorIndex(codes, 'FGA0124')).toBe(1);
    const colorOf = subjectPalette(codes, { FGA0124: 5 });
    expect(colorOf('FGA0124')).toBe(SUBJECT_COLORS[5]);
    expect(colorOf('FGA0030')).toBe(SUBJECT_COLORS[0]);
});
