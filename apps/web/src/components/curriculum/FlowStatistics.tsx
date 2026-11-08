import { Link } from '@tanstack/react-router';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import type { FlowStatistics, HistoryStatistics } from '#/lib/curriculum/statistics';
import type { FlowSubject } from '#/lib/curriculum/types';
import type { UserProfile } from '#/queries/me';

import { ListCard, Meter } from '#/components/ListCard';
import { SectionHeader } from '#/components/SectionHeader';
import { Badge } from '#/components/ui/badge';
import { Card } from '#/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '#/components/ui/chart';
import { Progress } from '#/components/ui/progress';
import { GRADES, projectedSemester } from '#/lib/curriculum/statistics';
import { titleCase } from '#/lib/profile';
import { cn } from '#/lib/shadcn';

const number = new Intl.NumberFormat('pt-BR');
const percent = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);
const hoursChart = { hours: { label: 'Horas aprovadas', color: 'var(--color-primary)' } };

interface FlowStatisticsViewProps {
    flow: FlowStatistics;
    // ausente quando o histórico não carregou
    history?: HistoryStatistics;
    user: Pick<UserProfile, 'integralization' | 'period_max_workload'>;
    // semestre regular em andamento, base da previsão
    semester?: string;
    manualCount: number;
}

export function FlowStatisticsView({
    flow,
    history,
    user,
    semester,
    manualCount
}: FlowStatisticsViewProps) {
    const { total, completed, enrolled, overdue } = flow;
    const tiles = [
        {
            label: 'Concluídas',
            value: `${completed.subjects}/${total.subjects}`,
            detail: `${percent(completed.subjects, total.subjects)}% das matérias`
        },
        {
            label: 'Carga cumprida',
            value: `${number.format(completed.hours)}h`,
            detail: `de ${number.format(total.hours)}h obrigatórias`
        },
        {
            label: 'Em curso',
            value: String(enrolled.subjects),
            detail: `${number.format(enrolled.hours)}h neste semestre`
        },
        {
            label: 'Atrasadas',
            value: String(overdue.length),
            detail: overdue.length ? 'de semestres já passados' : 'nenhuma pendência antiga',
            alert: overdue.length > 0
        }
    ];

    return (
        <div className="flex flex-col gap-6 pb-8">
            <dl className="grid grid-cols-2 gap-2 desk:grid-cols-4">
                {tiles.map((tile) => (
                    <Card key={tile.label} size="sm" className="gap-1 px-3">
                        <dt className="text-xs font-medium text-muted-foreground">{tile.label}</dt>
                        <dd
                            className={cn(
                                'text-2xl font-semibold tracking-tight text-primary tabular-nums',
                                tile.alert && 'text-destructive'
                            )}
                        >
                            {tile.value}
                        </dd>
                        <dd className="text-xs text-muted-foreground">{tile.detail}</dd>
                    </Card>
                ))}
            </dl>

            <div className="flex flex-col gap-6 desk:grid desk:grid-cols-2 desk:items-start desk:gap-8">
                <div className="flex flex-col gap-6">
                    <section aria-label="Progresso">
                        <SectionHeader title="Progresso" />
                        <ListCard>
                            <Meter
                                label="Obrigatórias, pela carga horária"
                                value={percent(completed.hours, total.hours)}
                                detail={`${number.format(total.hours - completed.hours)}h obrigatórias restantes${manualCount ? ` · ${manualCount} marcada${manualCount === 1 ? '' : 's'} por você` : ''}`}
                            />
                            {user.integralization != null && (
                                <Meter
                                    label="Integralização no SIGAA"
                                    value={user.integralization}
                                    detail="Inclui optativas e atividades complementares."
                                />
                            )}
                        </ListCard>
                    </section>
                    <section aria-label="Por semestre">
                        <SectionHeader title="Por semestre" />
                        <ListCard>
                            {flow.periods.map((period) => (
                                <Meter
                                    key={period.period}
                                    label={`${period.period}º semestre`}
                                    value={percent(period.completed, period.total)}
                                    detail={`${period.completed} de ${period.total} concluídas${period.enrolled ? ` · ${period.enrolled} em curso` : ''}`}
                                />
                            ))}
                        </ListCard>
                    </section>
                </div>

                <div className="flex flex-col gap-6">
                    <Forecast flow={flow} semester={semester} maxHours={user.period_max_workload} />
                    <SubjectList
                        title="Pode cursar agora"
                        empty="Nenhuma matéria obrigatória liberada no momento."
                        subjects={flow.available}
                    />
                    {overdue.length > 0 && (
                        <SubjectList title="Atrasadas" subjects={overdue} tone="destructive" />
                    )}
                    {history && history.graded > 0 && <HistorySection history={history} />}
                </div>
            </div>
        </div>
    );
}

function Forecast({
    flow,
    semester,
    maxHours
}: {
    flow: FlowStatistics;
    semester?: string;
    maxHours?: number | null;
}) {
    const remainingHours = flow.total.hours - flow.completed.hours - flow.enrolled.hours;
    // o que pesa mais: a cadeia de pré-requisitos ou a carga máxima por semestre
    const byLoad = maxHours ? Math.ceil(remainingHours / maxHours) : 0;
    const semesters = Math.max(flow.remainingSemesters, byLoad);
    return (
        <section aria-label="Previsão">
            <SectionHeader title="Previsão" />
            <Card size="sm" className="gap-1 px-3">
                {semesters === 0 ? (
                    <p className="text-sm font-semibold">
                        Todas as obrigatórias concluídas ou em curso.
                    </p>
                ) : (
                    <>
                        <p className="text-2xl font-semibold tracking-tight text-primary tabular-nums">
                            {semesters} {semesters === 1 ? 'semestre' : 'semestres'}
                        </p>
                        <p className="text-sm">
                            no mínimo para as obrigatórias restantes
                            {semester && (
                                <>
                                    , terminando em{' '}
                                    <strong>{projectedSemester(semester, semesters)}</strong>
                                </>
                            )}
                            .
                        </p>
                        <p className="text-xs text-muted-foreground">
                            {flow.remainingSemesters >= byLoad
                                ? 'Limitado pela cadeia de pré-requisitos.'
                                : `Limitado pela carga máxima de ${maxHours}h por semestre.`}{' '}
                            Não considera optativas nem a oferta de turmas.
                        </p>
                    </>
                )}
            </Card>
        </section>
    );
}

function SubjectList({
    title,
    subjects,
    empty,
    tone
}: {
    title: string;
    subjects: FlowSubject[];
    empty?: string;
    tone?: 'destructive';
}) {
    return (
        <section aria-label={title}>
            <SectionHeader title={title} />
            {subjects.length === 0 ? (
                <p className="px-1 text-sm text-muted-foreground">{empty}</p>
            ) : (
                <ul className="flex flex-wrap gap-2">
                    {subjects.map((subject) => (
                        <li key={subject.code}>
                            <Link
                                to="/buscar"
                                search={{ q: subject.code, category: 'classrooms' }}
                                className="block"
                            >
                                <Badge
                                    variant="secondary"
                                    className={cn(
                                        'h-auto py-1 hover:bg-primary/10',
                                        tone === 'destructive' &&
                                            'bg-destructive/10 text-destructive'
                                    )}
                                >
                                    <span className="font-semibold">{subject.code}</span>
                                    {titleCase(subject.name)}
                                </Badge>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function HistorySection({ history }: { history: HistoryStatistics }) {
    const top = Math.max(...GRADES.map((grade) => history.grades[grade]));
    return (
        <section aria-label="Histórico">
            <SectionHeader title="Histórico" />
            <ListCard>
                <div className="flex items-baseline justify-between gap-2 py-3 text-sm">
                    <span className="text-muted-foreground">Aprovação nas turmas encerradas</span>
                    <span className="font-semibold text-primary tabular-nums">
                        {history.approvalRate}%
                    </span>
                </div>
                <dl className="flex flex-col gap-2 py-3" aria-label="Menções">
                    {GRADES.map((grade) => (
                        <div key={grade} className="flex items-center gap-3 text-sm">
                            <dt className="w-6 font-semibold">{grade}</dt>
                            <Progress
                                className="flex-1"
                                value={percent(history.grades[grade], top)}
                                aria-label={`Menção ${grade}`}
                            />
                            <dd className="w-6 text-right tabular-nums">{history.grades[grade]}</dd>
                        </div>
                    ))}
                </dl>
                {history.dropped > 0 && (
                    <p className="py-3 text-sm text-muted-foreground">
                        {history.dropped} {history.dropped === 1 ? 'trancamento' : 'trancamentos'}
                    </p>
                )}
                {history.hoursBySemester.length > 1 && (
                    <figure className="py-3" aria-label="Horas aprovadas por semestre">
                        <figcaption className="mb-2 text-sm font-medium">
                            Horas aprovadas por semestre
                        </figcaption>
                        <ChartContainer config={hoursChart} className="aspect-auto h-40 w-full">
                            <BarChart data={history.hoursBySemester} margin={{ top: 4 }}>
                                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                                <XAxis dataKey="semester" tickLine={false} axisLine={false} />
                                <YAxis hide />
                                <ChartTooltip
                                    content={
                                        <ChartTooltipContent
                                            formatter={(value) =>
                                                `${number.format(Number(value))}h`
                                            }
                                        />
                                    }
                                />
                                <Bar
                                    dataKey="hours"
                                    fill="var(--color-hours)"
                                    radius={[4, 4, 0, 0]}
                                    isAnimationActive={false}
                                />
                            </BarChart>
                        </ChartContainer>
                    </figure>
                )}
            </ListCard>
        </section>
    );
}
