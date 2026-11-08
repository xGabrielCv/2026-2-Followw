import { describe, expect, test } from 'bun:test';

import {
    balanceHistory,
    groupByDay,
    statementLines,
    statementSummary
} from '#/lib/restaurant-statement';

const statement = {
    balance: '10.40',
    group: 1 as const,
    entries: [
        { occurred_at: '2026-11-07T15:00:00Z', description: 'Saldo atual', amount: '10.40' },
        { occurred_at: '2026-10-01T15:00:00Z', description: 'Recarga', amount: '20.00' },
        { occurred_at: '2026-11-05T15:00:00Z', description: 'Grupo 1 Almoço', amount: '-5.20' },
        { occurred_at: '2026-11-06T22:00:00Z', description: 'Grupo 1 Jantar', amount: '-5.20' },
        { occurred_at: '2026-11-06T15:00:00Z', description: 'Grupo 1 Almoço', amount: '-5.20' },
        { occurred_at: '2026-11-04T15:00:00Z', description: 'Recarga', amount: '10.00' }
    ]
};

describe('statementLines', () => {
    test('ordena do mais recente, tira a linha de saldo e o grupo e reconstrói o saldo', () => {
        const lines = statementLines(statement);
        expect(lines.map((line) => [line.description, line.amount, line.balance])).toEqual([
            ['Jantar', -5.2, 10.4],
            ['Almoço', -5.2, 15.6],
            ['Almoço', -5.2, 20.8],
            ['Recarga', 10, 26],
            ['Recarga', 20, 16]
        ]);
    });

    test('usa a data de Brasília e não inventa saldo sem o atual', () => {
        const lines = statementLines({ ...statement, balance: null });
        // 22h UTC ainda é dia 6 em Brasília
        expect(lines[0].date).toBe('2026-11-06');
        expect(lines[0].balance).toBeUndefined();
    });
});

test('groupByDay junta as movimentações do mesmo dia', () => {
    expect(
        groupByDay(statementLines(statement)).map(({ date, lines }) => [date, lines.length])
    ).toEqual([
        ['2026-11-06', 2],
        ['2026-11-05', 1],
        ['2026-11-04', 1],
        ['2026-10-01', 1]
    ]);
});

test('statementSummary considera só os últimos 30 dias', () => {
    expect(statementSummary(statementLines(statement), '2026-11-07')).toEqual({
        days: 30,
        spent: 15.6,
        recharged: 10,
        meals: 3
    });
});

test('balanceHistory guarda o saldo ao fim de cada dia, em ordem cronológica', () => {
    expect(balanceHistory(statementLines(statement))).toEqual([
        { date: '2026-10-01', balance: 16 },
        { date: '2026-11-04', balance: 26 },
        { date: '2026-11-05', balance: 20.8 },
        { date: '2026-11-06', balance: 10.4 }
    ]);
});
