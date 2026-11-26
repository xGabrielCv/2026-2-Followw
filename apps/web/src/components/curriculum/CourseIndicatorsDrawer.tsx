import { useQuery } from '@tanstack/react-query';
import { Award, BarChart3, ChevronRight, Download, ExternalLink } from 'lucide-react';
import { useState } from 'react';

import type {
    CourseIndicatorsDetail,
    CourseYearMetrics,
    PasCycleEntry
} from '#/queries/indicators';

import { Button } from '#/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '#/components/ui/dialog';
import { downloadOpenData } from '#/lib/open-data';
import { cn } from '#/lib/shadcn';
import {
    ORIGIN_LABELS,
    STATISTICS_SOURCE_LABELS,
    resolveComparisonData,
    useStatisticsSource
} from '#/lib/statistics-source';
import { comparisonQueryOptions } from '#/queries/comparison';
import {
    courseIndicatorsQueryOptions,
    formatIndicatorNumber,
    formatIndicatorPercent,
    formatPasScore
} from '#/queries/indicators';

export interface CourseIndicatorsDrawerProps {
    courseId: number;
    courseName: string;
    degree?: string | null;
    modality?: string | null;
}

function slugifyCourse(name: string, fallbackId: number): string {
    const slug = name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    return slug || String(fallbackId);
}

/** Exibe dois cartões públicos (funciona também sem login): Nota de corte PAS e Estatísticas do curso. */
export function CourseIndicatorsDrawer({
    courseId,
    courseName,
    degree,
    modality
}: CourseIndicatorsDrawerProps) {
    const { data } = useQuery(courseIndicatorsQueryOptions(courseId, degree, modality));
    if (!data) return null;

    const history = data.pas_history ?? [];
    const metricsHistory = data.historical_metrics ?? [];
    const hasPas = history.length > 0;
    const hasDpo = metricsHistory.length > 0 || data.latest_metrics != null;
    if (!hasPas && !hasDpo) return null;

    const slugBase = slugifyCourse(courseName, courseId);

    return (
        <div className="mt-3 flex flex-col gap-2">
            {hasPas && (
                <CoursePasDialog
                    courseName={courseName}
                    slugBase={slugBase}
                    data={data}
                    history={history}
                />
            )}
            <CourseStatisticsDialog
                courseId={courseId}
                courseName={courseName}
                slugBase={slugBase}
                latestMetrics={data.latest_metrics ?? metricsHistory[0] ?? null}
                metricsHistory={metricsHistory}
            />
        </div>
    );
}

function CoursePasDialog({
    courseName,
    slugBase,
    data,
    history
}: {
    courseName: string;
    slugBase: string;
    data: CourseIndicatorsDetail;
    history: PasCycleEntry[];
}) {
    const [open, setOpen] = useState(false);
    const [selectedCycle, setSelectedCycle] = useState('');

    const currentPas =
        history.find((entry) => entry.ciclo === selectedCycle) ??
        history.find((entry) => entry.minimo != null) ??
        history[0];
    if (!currentPas) return null;

    const currentPdfUrl = `${currentPas.url}${currentPas.pagina ? `#page=${currentPas.pagina}` : ''}`;

    const pasSummaryText =
        data.pas_latest != null
            ? `Sistema Universal: ${formatPasScore(data.pas_latest)}${
                  data.pas_average != null && history.length > 1
                      ? ` · Média: ${formatPasScore(data.pas_average)}`
                      : ''
              }`
            : 'Ver histórico e cotas';

    const exportRows = () =>
        history.map((entry) => ({
            curso: courseName,
            ciclo: entry.ciclo,
            sistema_universal_min: entry.minimo ?? null,
            sistema_universal_max: entry.maximo ?? null,
            media_pas_ciclos: data.pas_average ?? null,
            ingresso_conjunto_fcte: entry.ingresso_conjunto ?? false,
            fonte: 'Cebraspe/UnB (boletins PAS via Tamburetei UnB)'
        }));

    return (
        <>
            <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => setOpen(true)}
                className="flex w-full min-w-0 items-center gap-2.5 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-left text-xs transition-colors outline-none hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring"
            >
                <Award className="size-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0 flex-1 wrap-anywhere">
                    <span className="font-semibold text-foreground">
                        Nota de corte PAS ({data.pas_cycle ?? history[0]?.ciclo})
                    </span>
                    <span className="ml-1.5 text-muted-foreground">{pasSummaryText}</span>
                </span>
                <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                />
            </button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Notas de corte do PAS · UnB</DialogTitle>
                        <DialogDescription>
                            Menor argumento final dos selecionados nos boletins oficiais do Cebraspe
                            (PAS 3ª etapa).
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex max-h-[60dvh] flex-col gap-4 overflow-y-auto pr-1 text-xs">
                        <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="font-semibold text-primary">
                                        PAS {data.pas_cycle ?? history[0]?.ciclo} · Sistema
                                        Universal
                                    </p>
                                    {data.pas_average != null && history.length > 1 && (
                                        <p className="mt-0.5 text-muted-foreground">
                                            Média dos ciclos disponíveis:{' '}
                                            <strong className="text-foreground tabular-nums">
                                                {formatPasScore(data.pas_average)}
                                            </strong>
                                        </p>
                                    )}
                                    {history[0]?.ingresso_conjunto && (
                                        <p className="mt-0.5 text-muted-foreground">
                                            Ingresso conjunto das Engenharias do Gama (FCTE)
                                        </p>
                                    )}
                                </div>
                                <strong className="text-xl font-bold text-primary tabular-nums">
                                    {data.pas_latest != null
                                        ? formatPasScore(data.pas_latest)
                                        : 'Não disponível'}
                                </strong>
                            </div>
                            <p className="mt-2 leading-relaxed text-muted-foreground">
                                Argumentos negativos são válidos. “Não informado” indica que o
                                boletim oficial do Cebraspe não registrou selecionado nessa cota
                                (não significa nota zero).
                            </p>
                        </div>

                        <section
                            aria-label="Notas por modalidade de concorrência"
                            className="space-y-2"
                        >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <h3 className="text-sm font-semibold text-foreground">
                                    Modalidades e cotas
                                </h3>
                                <label className="flex items-center gap-1.5 text-muted-foreground">
                                    <span>Ciclo:</span>
                                    <select
                                        aria-label="Ciclo do PAS"
                                        value={currentPas.ciclo}
                                        onChange={(event) => setSelectedCycle(event.target.value)}
                                        className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground"
                                    >
                                        {history.map((entry) => (
                                            <option key={entry.ciclo} value={entry.ciclo}>
                                                {entry.ciclo}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                                {(currentPas.modalidades ?? []).map((item) => {
                                    const score = currentPas.cotas?.[item.id];
                                    return (
                                        <li key={item.id} className="p-3">
                                            <p className="text-[11px] text-muted-foreground">
                                                {item.sistema}
                                            </p>
                                            <p className="mt-0.5 font-semibold wrap-anywhere text-foreground">
                                                {item.descricao}
                                            </p>
                                            <dl className="mt-1.5 grid grid-cols-2 gap-2">
                                                <div>
                                                    <dt className="text-muted-foreground">
                                                        Mínimo
                                                    </dt>
                                                    <dd className="font-semibold tabular-nums">
                                                        {formatPasScore(score?.minimo)}
                                                    </dd>
                                                </div>
                                                <div>
                                                    <dt className="text-muted-foreground">
                                                        Máximo
                                                    </dt>
                                                    <dd className="font-semibold tabular-nums">
                                                        {formatPasScore(score?.maximo)}
                                                    </dd>
                                                </div>
                                            </dl>
                                        </li>
                                    );
                                })}
                            </ul>
                            <a
                                href={currentPdfUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                referrerPolicy="no-referrer"
                                className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-4"
                            >
                                Boletim Cebraspe · {currentPas.ciclo} (p. {currentPas.pagina})
                                <ExternalLink className="size-3" aria-hidden="true" />
                            </a>
                        </section>

                        <section aria-label="Histórico por ciclo" className="space-y-2">
                            <h3 className="text-sm font-semibold text-foreground">
                                Histórico do PAS ({history.length}{' '}
                                {history.length === 1 ? 'ciclo' : 'ciclos'})
                            </h3>
                            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                                {history.map((entry) => (
                                    <li
                                        key={entry.ciclo}
                                        className="flex items-center justify-between gap-3 px-3 py-2"
                                    >
                                        <div className="min-w-0">
                                            <p className="font-semibold text-foreground">
                                                {entry.ciclo}
                                            </p>
                                            {entry.ingresso_conjunto && (
                                                <p className="text-[11px] text-muted-foreground">
                                                    Ingresso conjunto (FCTE)
                                                </p>
                                            )}
                                        </div>
                                        <span className="shrink-0 font-bold text-foreground tabular-nums">
                                            {formatPasScore(entry.minimo)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </section>

                        <section aria-label="Exportar notas do PAS" className="space-y-2">
                            <h3 className="text-sm font-semibold text-foreground">Dados abertos</h3>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                        downloadOpenData(
                                            `followw-pas-${slugBase}`,
                                            exportRows(),
                                            'csv'
                                        )
                                    }
                                >
                                    <Download className="size-3.5" aria-hidden="true" />
                                    Exportar CSV
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                        downloadOpenData(
                                            `followw-pas-${slugBase}`,
                                            exportRows(),
                                            'json'
                                        )
                                    }
                                >
                                    <Download className="size-3.5" aria-hidden="true" />
                                    Exportar JSON
                                </Button>
                            </div>
                        </section>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                            Fechar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

function CourseStatisticsDialog({
    courseId,
    courseName,
    slugBase,
    latestMetrics,
    metricsHistory
}: {
    courseId: number;
    courseName: string;
    slugBase: string;
    latestMetrics: CourseYearMetrics | null;
    metricsHistory: CourseYearMetrics[];
}) {
    const [open, setOpen] = useState(false);
    const [selectedYear, setSelectedYear] = useState('');
    const sourceMode = useStatisticsSource();
    // Carrega os índices públicos das matérias do curso sob demanda (disponível sem login).
    const comparison = useQuery({
        ...comparisonQueryOptions(courseId),
        enabled: open
    });

    const currentMetrics =
        metricsHistory.find((item) => String(item.ano) === selectedYear) ??
        latestMetrics ??
        metricsHistory[0] ??
        null;

    const resolved = comparison.data ? resolveComparisonData(comparison.data, sourceMode) : null;
    const courseRates = resolved?.comparison.course ?? null;
    const subjects = resolved?.comparison.subjects ?? [];
    const maxEnrolled = Math.max(1, ...metricsHistory.map((item) => item.matriculados ?? 0));
    const orderedYears = [...metricsHistory].toSorted((a, b) => a.ano - b.ano);

    const summarySubtitle = latestMetrics
        ? `DPO ${latestMetrics.ano}: ${formatIndicatorNumber(latestMetrics.matriculados)} matriculados · Formação ${formatIndicatorPercent(latestMetrics.taxa_sucesso)} · Evasão ${formatIndicatorPercent(latestMetrics.taxa_evasao)}`
        : 'Ver índices públicos das matérias e evolução do curso';

    const exportRows = () => {
        const rows: Record<string, string | number | null>[] = [];
        for (const item of metricsHistory) {
            rows.push({
                tipo: 'dpo_institucional',
                curso: courseName,
                periodo_ou_codigo: String(item.ano),
                nome: courseName,
                matriculados: item.matriculados ?? null,
                ingressantes: item.ingressantes ?? null,
                concluintes: item.concluintes ?? null,
                trancados: item.trancados ?? null,
                taxa_formacao_pct: item.taxa_sucesso ?? null,
                taxa_evasao_pct: item.taxa_evasao ?? null,
                aprovacao_pct: null,
                reprovacao_pct: null,
                trancamento_pct: null,
                fonte: 'DPO/UnB (via Tamburetei UnB)'
            });
        }
        for (const subject of subjects) {
            const origin = resolved?.originByCode.get(subject.code) ?? 'followw';
            rows.push({
                tipo: 'disciplina_curso',
                curso: courseName,
                periodo_ou_codigo: subject.code,
                nome: subject.name,
                matriculados: null,
                ingressantes: null,
                concluintes: null,
                trancados: null,
                taxa_formacao_pct: null,
                taxa_evasao_pct: null,
                aprovacao_pct: subject.rates.approved,
                reprovacao_pct: subject.rates.failed,
                trancamento_pct: subject.rates.dropped,
                fonte: ORIGIN_LABELS[origin]
            });
        }
        return rows;
    };

    return (
        <>
            <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => setOpen(true)}
                className="flex w-full min-w-0 items-center gap-2.5 rounded-xl border border-info/25 bg-info/5 px-3 py-2 text-left text-xs transition-colors outline-none hover:border-info/50 focus-visible:ring-2 focus-visible:ring-ring"
            >
                <BarChart3 className="size-4 shrink-0 text-info" aria-hidden="true" />
                <span className="min-w-0 flex-1 wrap-anywhere">
                    <span className="font-semibold text-foreground">Estatísticas do curso</span>
                    <span className="ml-1.5 text-muted-foreground">{summarySubtitle}</span>
                </span>
                <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                />
            </button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Estatísticas e indicadores do curso</DialogTitle>
                        <DialogDescription>
                            Dados institucionais públicos (DPO/UnB) e índices agregados de aprovação
                            das matérias ({STATISTICS_SOURCE_LABELS[sourceMode]}). Disponível sem
                            login.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex max-h-[60dvh] flex-col gap-4 overflow-y-auto pr-1 text-xs">
                        {currentMetrics && (
                            <section
                                aria-label="Indicadores institucionais do curso"
                                className="space-y-2.5"
                            >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <h3 className="text-sm font-semibold text-foreground">
                                        Indicadores DPO/UnB
                                    </h3>
                                    {metricsHistory.length > 1 && (
                                        <label className="flex items-center gap-1.5 text-muted-foreground">
                                            <span>Ano:</span>
                                            <select
                                                aria-label="Ano dos indicadores institucionais"
                                                value={String(currentMetrics.ano)}
                                                onChange={(event) =>
                                                    setSelectedYear(event.target.value)
                                                }
                                                className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground"
                                            >
                                                {metricsHistory.map((item) => (
                                                    <option key={item.ano} value={String(item.ano)}>
                                                        {item.ano}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                    )}
                                </div>
                                <dl className="grid grid-cols-2 gap-2">
                                    <MetricTile
                                        label="Matriculados"
                                        value={formatIndicatorNumber(currentMetrics.matriculados)}
                                    />
                                    <MetricTile
                                        label="Ingressantes"
                                        value={formatIndicatorNumber(currentMetrics.ingressantes)}
                                    />
                                    <MetricTile
                                        label="Concluintes"
                                        value={formatIndicatorNumber(currentMetrics.concluintes)}
                                    />
                                    <MetricTile
                                        label="Trancados"
                                        value={formatIndicatorNumber(currentMetrics.trancados)}
                                    />
                                    <MetricTile
                                        label="Taxa de formação"
                                        value={formatIndicatorPercent(currentMetrics.taxa_sucesso)}
                                        tone="text-primary"
                                    />
                                    <MetricTile
                                        label="Taxa de evasão"
                                        value={formatIndicatorPercent(currentMetrics.taxa_evasao)}
                                        tone="text-destructive"
                                    />
                                </dl>
                                {orderedYears.length > 1 && (
                                    <div className="space-y-1.5 rounded-xl border border-border bg-card p-3">
                                        <p className="font-semibold text-foreground">
                                            Evolução anual (matriculados e evasão)
                                        </p>
                                        <ul className="space-y-1.5">
                                            {orderedYears.map((item) => {
                                                const widthPct = Math.max(
                                                    4,
                                                    Math.round(
                                                        ((item.matriculados ?? 0) / maxEnrolled) *
                                                            100
                                                    )
                                                );
                                                return (
                                                    <li key={item.ano} className="space-y-0.5">
                                                        <div className="flex items-center justify-between gap-2 tabular-nums">
                                                            <span className="font-medium text-foreground">
                                                                {item.ano}
                                                            </span>
                                                            <span className="text-muted-foreground">
                                                                {formatIndicatorNumber(
                                                                    item.matriculados
                                                                )}{' '}
                                                                matr. ·{' '}
                                                                {formatIndicatorNumber(
                                                                    item.concluintes
                                                                )}{' '}
                                                                concl. · evasão{' '}
                                                                {formatIndicatorPercent(
                                                                    item.taxa_evasao
                                                                )}
                                                            </span>
                                                        </div>
                                                        <div
                                                            className="h-1.5 overflow-hidden rounded-full bg-muted"
                                                            aria-hidden="true"
                                                        >
                                                            <div
                                                                className="h-full rounded-full bg-info"
                                                                style={{ width: `${widthPct}%` }}
                                                            />
                                                        </div>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    </div>
                                )}
                            </section>
                        )}

                        <section aria-label="Índices públicos das matérias" className="space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <h3 className="text-sm font-semibold text-foreground">
                                    Aprovação e reprovação das matérias
                                </h3>
                                <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                    {STATISTICS_SOURCE_LABELS[sourceMode]}
                                </span>
                            </div>
                            {comparison.isPending ? (
                                <p className="text-muted-foreground">
                                    Carregando índices do curso…
                                </p>
                            ) : comparison.isError ? (
                                <p className="text-muted-foreground">
                                    Índices das matérias temporariamente indisponíveis.
                                </p>
                            ) : (
                                <>
                                    {courseRates && (
                                        <dl className="grid grid-cols-2 gap-2">
                                            <MetricTile
                                                label="Aprovação média"
                                                value={formatIndicatorPercent(courseRates.approved)}
                                                tone="text-primary"
                                            />
                                            <MetricTile
                                                label="Reprovação média"
                                                value={formatIndicatorPercent(courseRates.failed)}
                                                tone="text-destructive"
                                            />
                                        </dl>
                                    )}
                                    {subjects.length > 0 ? (
                                        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                                            {subjects.slice(0, 8).map((subject) => (
                                                <li
                                                    key={subject.code}
                                                    className="space-y-1 px-3 py-2"
                                                >
                                                    <div className="flex items-baseline gap-2">
                                                        <span className="font-semibold text-primary">
                                                            {subject.code}
                                                        </span>
                                                        <span className="min-w-0 flex-1 truncate text-foreground">
                                                            {subject.name}
                                                        </span>
                                                        <span className="shrink-0 font-semibold text-destructive tabular-nums">
                                                            {formatIndicatorPercent(
                                                                subject.rates.failed
                                                            )}{' '}
                                                            reprov.
                                                        </span>
                                                    </div>
                                                    <div
                                                        className="h-1.5 overflow-hidden rounded-full bg-muted"
                                                        aria-hidden="true"
                                                    >
                                                        <div
                                                            className="h-full rounded-full bg-destructive/75"
                                                            style={{
                                                                width: `${Math.min(100, subject.rates.failed)}%`
                                                            }}
                                                        />
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="rounded-xl border border-border p-3 text-muted-foreground">
                                            Ainda não há índices de matérias disponíveis nesta fonte
                                            para este curso.
                                        </p>
                                    )}
                                </>
                            )}
                        </section>

                        <section aria-label="Exportar estatísticas do curso" className="space-y-2">
                            <h3 className="text-sm font-semibold text-foreground">Dados abertos</h3>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                        downloadOpenData(
                                            `followw-curso-estatisticas-${slugBase}`,
                                            exportRows(),
                                            'csv'
                                        )
                                    }
                                >
                                    <Download className="size-3.5" aria-hidden="true" />
                                    Exportar CSV
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                        downloadOpenData(
                                            `followw-curso-estatisticas-${slugBase}`,
                                            exportRows(),
                                            'json'
                                        )
                                    }
                                >
                                    <Download className="size-3.5" aria-hidden="true" />
                                    Exportar JSON
                                </Button>
                            </div>
                        </section>

                        <p className="text-[11px] text-muted-foreground">
                            Fontes: DPO/UnB (compilação aberta{' '}
                            <a
                                href="https://github.com/unb-mds/2026-02-TambureteiUnB"
                                target="_blank"
                                rel="noopener noreferrer"
                                referrerPolicy="no-referrer"
                                className="text-primary underline underline-offset-4"
                            >
                                Tamburetei UnB
                            </a>
                            ) e turmas compartilhadas anonimamente no Followw.
                        </p>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                            Fechar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}

function MetricTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
    return (
        <div className="rounded-xl border border-border bg-card p-2.5">
            <dt className="text-[11px] text-muted-foreground">{label}</dt>
            <dd
                className={cn('mt-0.5 text-base font-bold tabular-nums', tone ?? 'text-foreground')}
            >
                {value}
            </dd>
        </div>
    );
}
