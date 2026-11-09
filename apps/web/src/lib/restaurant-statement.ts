import type { RestaurantStatement } from '#/queries/restaurant-account';

import { addDays, nowInBrasilia } from '#/lib/schedule';

export interface StatementLine {
    occurredAt: string;
    /** `AAAA-MM-DD` em Brasília. */
    date: string;
    description: string;
    amount: number;
    /** Saldo logo após a movimentação; ausente sem o saldo atual. */
    balance?: number;
}

const SUMMARY_DAYS = 30;
const isBalanceRow = (description: string) => /^saldo\b/i.test(description.trim());

/** Movimentações da mais recente à mais antiga, com o saldo reconstruído a partir do atual. */
export function statementLines({
    entries,
    balance
}: Pick<RestaurantStatement, 'entries'> & { balance?: string | null }): StatementLine[] {
    const lines = entries
        .filter((entry) => !isBalanceRow(entry.description))
        .map((entry): StatementLine => ({
            occurredAt: entry.occurred_at,
            date: nowInBrasilia(new Date(entry.occurred_at)).date,
            description: entry.description.replace(/^grupo\s*\d+\s+/i, '').trim(),
            amount: Number(entry.amount)
        }))
        .toSorted((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    if (balance == null) return lines;
    let after = Number(balance);
    for (const line of lines) {
        line.balance = Math.round(after * 100) / 100;
        after -= line.amount;
    }
    return lines;
}

/** Linhas agrupadas por dia, na mesma ordem. */
export function groupByDay(lines: StatementLine[]) {
    const days = new Map<string, StatementLine[]>();
    for (const line of lines) days.set(line.date, [...(days.get(line.date) ?? []), line]);
    return [...days].map(([date, items]) => ({ date, lines: items }));
}

export interface StatementSummary {
    days: number;
    spent: number;
    recharged: number;
    meals: number;
}

/** Gastos, recargas e refeições nos últimos 30 dias até `today`. */
export function statementSummary(lines: StatementLine[], today: string): StatementSummary {
    const since = addDays(today, -(SUMMARY_DAYS - 1));
    const recent = lines.filter((line) => line.date >= since && line.date <= today);
    const sum = (items: StatementLine[]) =>
        Math.round(items.reduce((total, line) => total + line.amount, 0) * 100) / 100;
    const debits = recent.filter((line) => line.amount < 0);
    return {
        days: SUMMARY_DAYS,
        spent: -sum(debits),
        recharged: sum(recent.filter((line) => line.amount > 0)),
        meals: debits.length
    };
}

/** Saldo ao fim de cada dia, do mais antigo ao mais recente, para o gráfico. */
export function balanceHistory(lines: StatementLine[]) {
    return groupByDay(lines)
        .flatMap(({ date, lines: items }) =>
            items[0].balance === undefined ? [] : [{ date, balance: items[0].balance }]
        )
        .toReversed();
}
