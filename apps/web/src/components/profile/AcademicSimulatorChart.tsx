import type { ComponentProps } from 'react';

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';

import type { EvolutionChartPoint } from '#/lib/academic-simulation';

import { ChartContainer, ChartTooltip, ChartTooltipContent } from '#/components/ui/chart';
import { formatAcademicIndex } from '#/lib/profile';

function projectedDot({
    cx,
    cy,
    payload
}: {
    cx?: number;
    cy?: number;
    payload?: EvolutionChartPoint;
}) {
    if (payload?.projected && cx != null && cy != null) {
        return (
            <circle
                key={payload.semester}
                cx={cx}
                cy={cy}
                r={3}
                fill="var(--color-projectedIra)"
                stroke="var(--color-projectedIra)"
            />
        );
    }
    return <g key={payload?.semester} />;
}

function SimulatorTooltip({
    payload,
    current,
    projected,
    ...props
}: ComponentProps<typeof ChartTooltipContent> & {
    current: string | undefined;
    projected: boolean;
}) {
    return (
        <ChartTooltipContent
            {...props}
            payload={payload?.filter((item) => item.value != null).slice(0, 1)}
            indicator="dot"
            labelFormatter={(semester) =>
                projected && typeof semester === 'string' && semester === current
                    ? `${semester} · Projeção`
                    : semester
            }
            formatter={(value) => `IRA ${formatAcademicIndex(Number(value))}`}
        />
    );
}

export function AcademicSimulatorChart({
    chartData,
    current,
    projected,
    projectedDropped
}: {
    chartData: EvolutionChartPoint[];
    current?: string;
    projected: boolean;
    projectedDropped: boolean;
}) {
    const chartConfig = {
        ira: { label: 'IRA', color: 'var(--info)' },
        projectedIra: {
            label: 'Projeção',
            color: projectedDropped ? 'var(--destructive)' : 'var(--success)'
        }
    };

    return (
        <div className="overflow-x-auto">
            <ChartContainer
                config={chartConfig}
                className="h-56 w-full"
                style={{ minWidth: chartData.length * 42 + 44 }}
            >
                <LineChart data={chartData} margin={{ left: 0, right: 20, top: 8 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                        dataKey="semester"
                        tickFormatter={(semester: string) =>
                            semester.slice(2) + (projected && semester === current ? '*' : '')
                        }
                        tickMargin={8}
                        interval={0}
                    />
                    <YAxis domain={[0, 5]} allowDecimals={false} width={24} />
                    <ChartTooltip
                        content={<SimulatorTooltip current={current} projected={projected} />}
                    />
                    <Line
                        dataKey="ira"
                        stroke="var(--color-ira)"
                        strokeWidth={2}
                        dot={{ r: 3, fill: 'var(--color-ira)' }}
                        connectNulls={false}
                        isAnimationActive={false}
                    />
                    <Line
                        dataKey="projectedIra"
                        stroke="var(--color-projectedIra)"
                        strokeWidth={2}
                        dot={projectedDot}
                        connectNulls={false}
                        isAnimationActive={false}
                    />
                </LineChart>
            </ChartContainer>
        </div>
    );
}
