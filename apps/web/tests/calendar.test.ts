import { describe, expect, test } from 'bun:test';

import { getNoClassEvents, getNoClassReason, semesterProgress, upcomingEvents } from '#/calendar';

describe('getNoClassEvents', () => {
    test('inclui todos os dias da Semana Universitária', () => {
        expect(getNoClassEvents('2026-09-20').map((event) => event.id)).toEqual([
            'university_week'
        ]);
        expect(getNoClassEvents('2026-09-22').map((event) => event.id)).toEqual([
            'university_week'
        ]);
        expect(getNoClassEvents('2026-09-25').map((event) => event.id)).toEqual([
            'university_week'
        ]);
        expect(getNoClassEvents('2026-09-26')).toEqual([]);
    });

    test('inclui feriados e pontos facultativos', () => {
        expect(getNoClassEvents('2026-10-12').map((event) => event.id)).toEqual([
            'our_lady_aparecida'
        ]);
        expect(getNoClassEvents('2026-11-02').map((event) => event.id)).toEqual(['all_souls_day']);
    });

    test('ignora eventos acadêmicos e datas sem evento', () => {
        expect(getNoClassEvents('2026-10-09')).toEqual([]);
        expect(getNoClassEvents('2030-10-12')).toEqual([]);
    });
});

describe('getNoClassReason', () => {
    test('usa o nome do evento como motivo', () => {
        expect(getNoClassReason('2026-09-22')).toBe('Semana Universitária 2026');
        expect(getNoClassReason('2026-11-20')).toBe('Dia de Zumbi e da Consciência Negra');
    });

    test('sinaliza datas fora do período de aulas do semestre', () => {
        expect(getNoClassReason('2026-08-09')).toBe('Fora do período de aulas');
        expect(getNoClassReason('2026-08-10')).toBeUndefined();
        expect(getNoClassReason('2026-12-15')).toBe('Fora do período de aulas');
    });

    test('mantém a grade quando a data não consta em um semestre', () => {
        expect(getNoClassReason('2028-02-23')).toBeUndefined();
    });
});

describe('semesterProgress', () => {
    test('mede o período de aulas do semestre corrente', () => {
        expect(semesterProgress('2026-11-07')).toEqual({
            semester: '2026.2',
            start: '2026-08-10',
            end: '2026-12-14',
            percent: 71,
            week: 13,
            weeks: 19,
            daysLeft: 37
        });
    });

    test('antes das aulas fica zerado e fora do calendário não existe', () => {
        expect(semesterProgress('2026-07-30')).toMatchObject({ percent: 0, week: 0 });
        expect(semesterProgress('2030-01-01')).toBeUndefined();
    });
});

test('upcomingEvents ordena pelo início ou, se já começou, pelo prazo', () => {
    expect(upcomingEvents('2026-11-13', 3).map((event) => event.id)).toEqual([
        'republic_day',
        'black_consciousness_day',
        'classes_end'
    ]);
    // o trancamento já começou e vence em 12/11, antes do feriado
    expect(upcomingEvents('2026-11-07', 2).map((event) => event.id)).toEqual([
        'registration_general_suspend',
        'three_quarters_semester'
    ]);
});
