import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { BarChart3, Download, Info, ShieldCheck } from 'lucide-react';
import { useQueryStates } from 'nuqs';
import { createStandardSchemaV1, parseAsStringLiteral } from 'nuqs/server';

import type { SubjectRate } from '#/queries/comparison';

import {
    ErrorCard,
    ErrorState,
    SIGAA_DOWN_MESSAGE,
    StaleDataNotice
} from '#/components/ErrorState';
import { BackHeader } from '#/components/HeaderBar';
import { LoginPromptCard } from '#/components/home/LoginPromptCard';
import { LoadingText } from '#/components/LoadingText';
import { TabFilter } from '#/components/TabFilter';
import { Button } from '#/components/ui/button';
import { Card } from '#/components/ui/card';
import { difference, insights } from '#/lib/comparison';
import { downloadOpenData } from '#/lib/open-data';
import { cn } from '#/lib/shadcn';
import {
    ORIGIN_LABELS,
    type ResolvedOrigin,
    STATISTICS_SOURCE_LABELS,
    resolveComparisonData,
    useStatisticsSource
} from '#/lib/statistics-source';
import { allClassroomsQueryOptions } from '#/queries/classrooms';
import { comparisonQueryOptions } from '#/queries/comparison';
import {
    type CourseYearMetrics,
    type UnbDashboardSummary,
    formatIndicatorNumber,
    formatIndicatorPercent
} from '#/queries/indicators';
import { meQueryOptions } from '#/queries/me';
import { useUserSettings } from '#/queries/settings';

const SCOPES = ['course', 'unb'] as const;
const parsers = { escopo: parseAsStringLiteral(SCOPES).withDefault('course') };

export const Route = createFileRoute('/_app/estatisticas')({
    validateSearch: createStandardSchemaV1(parsers, { partialOutput: true }),
    head: () => ({ meta: [{ title: 'Estatísticas comparadas | Followw' }] }),
    staticData: {
        header: () => <BackHeader to="/mais" title="Estatísticas comparadas" />
    },
    errorComponent: ErrorState,
    component: EstatisticasPage
});

function EstatisticasPage() {
    const { data: user } = useSuspenseQuery(meQueryOptions);
    return user ? <Compare courseId={user.course?.id} /> : <LoginPromptCard />;
}

const pct = (value: number | null | undefined) =>
    value == null ? '—' : `${value.toLocaleString('pt-BR')}%`;

function Compare({ courseId }: { courseId?: number }) {
    const [{ escopo }, setSearch] = useQueryStates(parsers, { history: 'replace', scroll: false });
    const scope = courseId ? escopo : 'unb';
    const history = useQuery(allClassroomsQueryOptions);
    const data = useQuery(comparisonQueryOptions(scope === 'course' ? courseId : undefined));
    const settings = useUserSettings();
    const sourceMode = useStatisticsSource();

    if (data.isPending || history.isPending)
        return <LoadingText>Juntando seus dados e as médias gerais...</LoadingText>;
    if (history.isLoadingError)
        return <ErrorCard message={SIGAA_DOWN_MESSAGE} onRetry={() => history.refetch()} />;
    if (data.isLoadingError)
        return (
            <ErrorCard
                message="Não foi possível carregar as médias gerais."
                onRetry={() => data.refetch()}
            />
        );

    const { comparison: effective, originByCode } = resolveComparisonData(data.data, sourceMode);
    const result = insights(history.data ?? [], effective, scope);
    const reference = scope === 'course' ? effective.course : effective.unb;
    const label = scope === 'course' ? 'do seu curso' : 'da UnB';

    return (
        <div className="flex flex-col gap-4 pb-8">
            {history.isError && <StaleDataNotice subject="seu histórico" />}
            {data.isError && <StaleDataNotice subject="as médias gerais" />}
            <Card className="flex-row gap-3 bg-primary/5 p-3 text-sm ring-primary/20">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <p className="text-muted-foreground">
                    A comparação é feita <strong>neste aparelho</strong>: seu histórico não é
                    enviado. Fonte ativa:{' '}
                    <strong className="text-foreground">
                        {STATISTICS_SOURCE_LABELS[sourceMode]}
                    </strong>{' '}
                    (
                    <Link to="/perfil" className="text-primary underline underline-offset-4">
                        alterar em Perfil › Conta
                    </Link>
                    ).{' '}
                    {settings.shareStatistics
                        ? 'Suas turmas contribuem de forma anônima.'
                        : 'Você não libera os seus índices, então suas turmas ficam de fora.'}
                </p>
            </Card>
            {courseId && (
                <TabFilter
                    label="Comparar com"
                    value={scope}
                    options={SCOPES}
                    labels={{ course: 'Meu curso', unb: 'UnB inteira' }}
                    onChange={(value) =>
                        void setSearch({ escopo: value === 'course' ? null : value })
                    }
                />
            )}
            <div className="grid grid-cols-2 gap-3">
                <Tile label="Sua aprovação" value={pct(result.myRate)} tone="text-primary" />
                <Tile
                    label={`Aprovação média ${label}`}
                    value={pct(reference?.approved)}
                    hint={
                        reference
                            ? `${reference.classrooms} ${reference.classrooms === 1 ? 'turma' : 'turmas'}`
                            : 'Sem dados ainda'
                    }
                />
                <Tile
                    label="Média nas mesmas matérias"
                    value={pct(result.sameSubjectsRate)}
                    hint={`${result.covered} matérias suas com dados`}
                />
                <Tile
                    label={`Reprovação média ${label}`}
                    value={pct(reference?.failed)}
                    tone="text-destructive"
                />
            </div>
            <Summary result={result} label={label} />
            <InstitutionalPanorama
                scope={scope}
                courseIndicators={data.data.course_indicators}
                dashboard={data.data.dashboard}
            />
            <SubjectList
                title="Mais difíceis que você já passou"
                empty="Nenhuma matéria aprovada com índices ainda."
                items={result.hardestPassed}
            />
            <SubjectList
                title={`Mais reprovam entre as que faltam (${label})`}
                empty="Sem índices das matérias que faltam."
                items={result.hardestAhead}
            />
            {effective.subjects.length > 0 && (
                <OpenDataCard
                    scope={scope}
                    subjects={effective.subjects}
                    originByCode={originByCode}
                />
            )}
            <p className="flex gap-2 px-1 text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Cada turma pesa igual nas médias, e a cobertura cresce conforme mais alunos liberam
                os índices em Perfil, Conta. Não há comparação de IRA nem de ritmo com outros
                alunos: isso exigiria mandar dados seus para a nuvem.{' '}
                <Link to="/perfil/dados" className="text-primary underline underline-offset-4">
                    Uso de dados
                </Link>
            </p>
        </div>
    );
}

function InstitutionalPanorama({
    scope,
    courseIndicators,
    dashboard
}: {
    scope: 'course' | 'unb';
    courseIndicators?: CourseYearMetrics | null;
    dashboard?: UnbDashboardSummary | null;
}) {
    if (scope === 'course' && courseIndicators) {
        return (
            <Card className="flex flex-col gap-3 p-4 text-xs">
                <div className="flex items-center gap-2">
                    <BarChart3 className="size-4 text-primary" aria-hidden="true" />
                    <h2 className="text-sm font-semibold text-foreground">
                        Panorama institucional do curso (DPO/UnB · {courseIndicators.ano})
                    </h2>
                </div>
                <dl className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-border p-2.5">
                        <dt className="text-muted-foreground">Matriculados</dt>
                        <dd className="text-base font-bold tabular-nums">
                            {formatIndicatorNumber(courseIndicators.matriculados)}
                        </dd>
                    </div>
                    <div className="rounded-lg border border-border p-2.5">
                        <dt className="text-muted-foreground">Concluintes</dt>
                        <dd className="text-base font-bold tabular-nums">
                            {formatIndicatorNumber(courseIndicators.concluintes)}
                        </dd>
                    </div>
                    <div className="rounded-lg border border-border p-2.5">
                        <dt className="text-muted-foreground">Taxa de formação</dt>
                        <dd className="text-base font-bold text-primary tabular-nums">
                            {formatIndicatorPercent(courseIndicators.taxa_sucesso)}
                        </dd>
                    </div>
                    <div className="rounded-lg border border-border p-2.5">
                        <dt className="text-muted-foreground">Taxa de evasão</dt>
                        <dd className="text-base font-bold text-destructive tabular-nums">
                            {formatIndicatorPercent(courseIndicators.taxa_evasao)}
                        </dd>
                    </div>
                </dl>
            </Card>
        );
    }

    if (scope === 'unb' && dashboard) {
        return (
            <Card className="flex flex-col gap-3 p-4 text-xs">
                <div className="flex items-center gap-2">
                    <BarChart3 className="size-4 text-primary" aria-hidden="true" />
                    <h2 className="text-sm font-semibold text-foreground">
                        Panorama institucional da UnB (DPO/Tamburetei · {dashboard.total_cursos}{' '}
                        cursos)
                    </h2>
                </div>
                <dl className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-border p-2.5">
                        <dt className="text-muted-foreground">Matrículas acumuladas</dt>
                        <dd className="text-base font-bold tabular-nums">
                            {formatIndicatorNumber(dashboard.matriculados)}
                        </dd>
                    </div>
                    <div className="rounded-lg border border-border p-2.5">
                        <dt className="text-muted-foreground">Concluintes</dt>
                        <dd className="text-base font-bold tabular-nums">
                            {formatIndicatorNumber(dashboard.concluintes)}
                        </dd>
                    </div>
                    <div className="rounded-lg border border-border p-2.5">
                        <dt className="text-muted-foreground">Formação média</dt>
                        <dd className="text-base font-bold text-primary tabular-nums">
                            {formatIndicatorPercent(dashboard.taxa_media_formacao)}
                        </dd>
                    </div>
                    <div className="rounded-lg border border-border p-2.5">
                        <dt className="text-muted-foreground">Evasão média</dt>
                        <dd className="text-base font-bold text-destructive tabular-nums">
                            {formatIndicatorPercent(dashboard.taxa_media_evasao)}
                        </dd>
                    </div>
                </dl>
                {dashboard.resumo_campi && dashboard.resumo_campi.length > 0 && (
                    <ul className="divide-y divide-border rounded-lg border border-border">
                        {dashboard.resumo_campi.map((campus) => (
                            <li
                                key={campus.campus}
                                className="flex items-center justify-between gap-2 px-3 py-2"
                            >
                                <span className="font-medium text-foreground">{campus.campus}</span>
                                <span className="shrink-0 text-muted-foreground tabular-nums">
                                    Evasão {formatIndicatorPercent(campus.taxa_evasao)}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
                {dashboard.fluxo_estudantes && dashboard.fluxo_estudantes.length > 0 && (
                    <div className="space-y-1.5 rounded-lg border border-border p-3">
                        <p className="font-semibold text-foreground">
                            Evolução anual da UnB (2020–2024)
                        </p>
                        <ul className="divide-y divide-border">
                            {dashboard.fluxo_estudantes.map((year) => (
                                <li
                                    key={year.ano}
                                    className="flex flex-wrap items-center justify-between gap-2 py-1.5 tabular-nums"
                                >
                                    <span className="font-semibold text-foreground">
                                        {year.ano}
                                    </span>
                                    <span className="text-muted-foreground">
                                        {formatIndicatorNumber(year.matriculados)} matr. ·{' '}
                                        {formatIndicatorNumber(year.concluintes)} concl. · formação{' '}
                                        {formatIndicatorPercent(year.taxa_formacao)} · evasão{' '}
                                        {formatIndicatorPercent(year.taxa_evasao)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </Card>
        );
    }

    return null;
}

function OpenDataCard({
    scope,
    subjects,
    originByCode
}: {
    scope: string;
    subjects: SubjectRate[];
    originByCode: Map<string, ResolvedOrigin>;
}) {
    const rows = () =>
        subjects.map((item) => {
            const origin = originByCode.get(item.code) ?? 'followw';
            return {
                codigo: item.code,
                disciplina: item.name,
                aprovacao_pct: item.rates.approved,
                reprovacao_pct: item.rates.failed,
                trancamento_pct: item.rates.dropped,
                turmas: item.rates.classrooms,
                fonte: ORIGIN_LABELS[origin]
            };
        });
    return (
        <Card className="flex flex-col gap-3 p-4 text-xs">
            <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">Dados abertos</h2>
                <p className="mt-0.5 text-muted-foreground">
                    Baixe as médias públicas agregadas das matérias ({subjects.length} registros),
                    sem nenhum dado pessoal ou histórico individual.
                </p>
            </div>
            <div className="flex flex-wrap gap-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => downloadOpenData(`followw-estatisticas-${scope}`, rows(), 'csv')}
                >
                    <Download className="size-3.5" aria-hidden="true" />
                    Exportar CSV
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                        downloadOpenData(`followw-estatisticas-${scope}`, rows(), 'json')
                    }
                >
                    <Download className="size-3.5" aria-hidden="true" />
                    Exportar JSON
                </Button>
            </div>
        </Card>
    );
}

function Tile({
    label,
    value,
    hint,
    tone
}: {
    label: string;
    value: string;
    hint?: string;
    tone?: string;
}) {
    return (
        <Card size="sm" className="gap-1 p-3">
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className={cn('text-2xl font-bold tabular-nums', tone)}>{value}</span>
            {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </Card>
    );
}

function Summary({ result, label }: { result: ReturnType<typeof insights>; label: string }) {
    const approval = difference(result.myRate, result.sameSubjectsRate);
    const difficulty = difference(result.myDifficulty, result.scopeDifficulty);
    if (!approval && !difficulty) return null;
    return (
        <Card className="gap-2 p-4 text-sm">
            <h2 className="font-semibold">Resumo</h2>
            {approval && (
                <p className="text-muted-foreground">
                    Sua aprovação está <strong className="text-foreground">{approval}</strong> das
                    turmas das mesmas matérias.
                </p>
            )}
            {difficulty && (
                <p className="text-muted-foreground">
                    As matérias que você cursou reprovam em média {pct(result.myDifficulty)}:{' '}
                    <strong className="text-foreground">{difficulty}</strong> {label}.
                </p>
            )}
        </Card>
    );
}

function SubjectList({
    title,
    empty,
    items
}: {
    title: string;
    empty: string;
    items: SubjectRate[];
}) {
    return (
        <section className="flex flex-col gap-2">
            <h2 className="px-1 text-sm font-semibold">{title}</h2>
            {items.length === 0 ? (
                <p className="rounded-2xl bg-card p-4 text-sm text-muted-foreground">{empty}</p>
            ) : (
                <Card className="gap-0 divide-y divide-border px-4 py-1">
                    {items.map((item) => (
                        <div key={item.code} className="flex flex-col gap-1.5 py-2.5">
                            <div className="flex items-baseline gap-2 text-sm">
                                <span className="text-xs font-semibold text-primary">
                                    {item.code}
                                </span>
                                <span className="min-w-0 flex-1 truncate font-medium">
                                    {item.name}
                                </span>
                                <span className="text-xs font-semibold text-destructive tabular-nums">
                                    {pct(item.rates.failed)}
                                </span>
                            </div>
                            <span className="sr-only">
                                Reprovação de {pct(item.rates.failed)} em {item.rates.classrooms}{' '}
                                {item.rates.classrooms === 1 ? 'turma' : 'turmas'}
                            </span>
                            <div
                                className="h-1.5 overflow-hidden rounded-full bg-muted"
                                aria-hidden="true"
                            >
                                <div
                                    className="h-full rounded-full bg-destructive/70"
                                    style={{ width: `${Math.min(100, item.rates.failed)}%` }}
                                />
                            </div>
                        </div>
                    ))}
                </Card>
            )}
        </section>
    );
}
