import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import type { StatementLine } from '#/lib/restaurant-statement';

import { ChartContainer, ChartTooltip, ChartTooltipContent } from '#/components/ui/chart';
import { balanceHistory, groupByDay, statementSummary } from '#/lib/restaurant-statement';
import { cn } from '#/lib/shadcn';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dayLabel = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC'
});
const shortDay = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC'
});
const time = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit'
});
const asDate = (date: string) => new Date(`${date}T00:00:00Z`);

const chartConfig = { balance: { label: 'Saldo', color: 'var(--color-primary)' } };

export function StatementHistory({ lines, today }: { lines: StatementLine[]; today: string }) {
    if (lines.length === 0)
        return (
            <p className="mt-3 text-sm text-muted-foreground">Nenhuma movimentação no extrato.</p>
        );
    const summary = statementSummary(lines, today);
    const history = balanceHistory(lines);
    const stats = [
        { label: `Gasto em ${summary.days} dias`, value: currency.format(summary.spent) },
        { label: 'Recargas', value: currency.format(summary.recharged) },
        { label: 'Refeições', value: String(summary.meals) }
    ];

    return (
        <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-3 gap-2">
                {stats.map((stat) => (
                    <div key={stat.label} className="min-w-0 rounded-xl bg-muted/60 px-2 py-2">
                        <dt className="truncate text-xs text-muted-foreground">{stat.label}</dt>
                        <dd className="truncate text-sm font-bold tabular-nums">{stat.value}</dd>
                    </div>
                ))}
            </dl>
            {history.length > 1 && <BalanceChart history={history} />}
            <ol className="flex max-h-80 flex-col gap-3 overflow-y-auto" aria-label="Movimentações">
                {groupByDay(lines).map(({ date, lines: items }) => (
                    <li key={date}>
                        <h4 className="mb-1 text-xs font-semibold text-muted-foreground capitalize">
                            {dayLabel.format(asDate(date))}
                        </h4>
                        <ul className="flex flex-col gap-1">
                            {items.map((line) => (
                                <li
                                    key={`${line.occurredAt}-${line.description}-${line.amount}`}
                                    className="flex items-baseline gap-2"
                                >
                                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                        {time.format(new Date(line.occurredAt))}
                                    </span>
                                    <p className="min-w-0 truncate text-sm font-semibold text-foreground">
                                        {line.description}
                                    </p>
                                    <span className="ml-auto flex shrink-0 flex-col items-end">
                                        <span
                                            className={cn(
                                                'text-sm font-bold tabular-nums',
                                                line.amount < 0
                                                    ? 'text-destructive'
                                                    : 'text-success'
                                            )}
                                        >
                                            {currency.format(line.amount)}
                                        </span>
                                        {line.balance !== undefined && (
                                            <span className="text-xs text-muted-foreground tabular-nums">
                                                saldo {currency.format(line.balance)}
                                            </span>
                                        )}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </li>
                ))}
            </ol>
        </div>
    );
}

function BalanceChart({ history }: { history: { date: string; balance: number }[] }) {
    return (
        <figure aria-label="Saldo ao fim de cada dia com movimentação">
            <ChartContainer config={chartConfig} className="aspect-auto h-32 w-full">
                <AreaChart data={history} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis
                        dataKey="date"
                        tickLine={false}
                        axisLine={false}
                        minTickGap={24}
                        tickFormatter={(value: string) => shortDay.format(asDate(value))}
                    />
                    <YAxis hide domain={[0, 'auto']} />
                    <ChartTooltip
                        content={
                            <ChartTooltipContent
                                labelFormatter={(value) =>
                                    typeof value === 'string'
                                        ? dayLabel.format(asDate(value))
                                        : value
                                }
                                formatter={(value) => currency.format(Number(value))}
                            />
                        }
                    />
                    <Area
                        dataKey="balance"
                        type="stepAfter"
                        stroke="var(--color-balance)"
                        strokeWidth={2}
                        fill="var(--color-balance)"
                        fillOpacity={0.12}
                        isAnimationActive={false}
                    />
                </AreaChart>
            </ChartContainer>
        </figure>
    );
}
