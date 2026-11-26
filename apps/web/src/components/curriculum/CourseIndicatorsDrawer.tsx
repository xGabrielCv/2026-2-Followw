import { useQuery } from '@tanstack/react-query';
import { Award, BarChart3, ChevronRight, Download, ExternalLink } from 'lucide-react';
import { useState } from 'react';

import { Button } from '#/components/ui/button';
import {
    Drawer,
    DrawerClose,
    DrawerContent,
    DrawerDescription,
    DrawerFooter,
    DrawerHeader,
    DrawerTitle,
    DrawerTrigger
} from '#/components/ui/drawer';
import { downloadOpenData } from '#/lib/open-data';
import { cn } from '#/lib/shadcn';
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

export function CourseIndicatorsDrawer({
    courseId,
    courseName,
    degree,
    modality
}: CourseIndicatorsDrawerProps) {
    const { data } = useQuery(courseIndicatorsQueryOptions(courseId, degree, modality));
    const [selectedCycle, setSelectedCycle] = useState<string>('');
    const [selectedYear, setSelectedYear] = useState<string>('');

    if (!data) return null;

    const history = data.pas_history ?? [];
    const metricsHistory = data.historical_metrics ?? [];
    const hasPas = history.length > 0;
    const hasDpo = metricsHistory.length > 0 || data.latest_metrics != null;
    if (!hasPas && !hasDpo) return null;

    const currentPas =
        history.find((entry) => entry.ciclo === selectedCycle) ??
        history.find((entry) => entry.minimo != null) ??
        history[0];
    const currentMetrics =
        metricsHistory.find((item) => String(item.ano) === selectedYear) ??
        data.latest_metrics ??
        metricsHistory[0] ??
        null;

    const currentPdfUrl = currentPas
        ? `${currentPas.url}${currentPas.pagina ? `#page=${currentPas.pagina}` : ''}`
        : null;

    const slugBase = courseName
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

    const buildExportRows = () => {
        const rows: Record<string, string | number | boolean | null>[] = [];
        for (const entry of history) {
            rows.push({
                tipo: 'pas',
                curso: courseName,
                periodo: entry.ciclo,
                sistema_universal_min: entry.minimo ?? null,
                sistema_universal_max: entry.maximo ?? null,
                media_pas_ciclos: data.pas_average ?? null,
                ingresso_conjunto_fcte: entry.ingresso_conjunto ?? false,
                matriculados: null,
                ingressantes: null,
                concluintes: null,
                trancados: null,
                desvinculados: null,
                taxa_sucesso_pct: null,
                taxa_evasao_pct: null,
                fonte: 'Cebraspe/UnB (via Tamburetei UnB)'
            });
        }
        for (const item of metricsHistory) {
            rows.push({
                tipo: 'dpo_institucional',
                curso: courseName,
                periodo: String(item.ano),
                sistema_universal_min: null,
                sistema_universal_max: null,
                media_pas_ciclos: null,
                ingresso_conjunto_fcte: false,
                matriculados: item.matriculados ?? null,
                ingressantes: item.ingressantes ?? null,
                concluintes: item.concluintes ?? null,
                trancados: item.trancados ?? null,
                desvinculados: item.desvinculados ?? null,
                taxa_sucesso_pct: item.taxa_sucesso ?? null,
                taxa_evasao_pct: item.taxa_evasao ?? null,
                fonte: 'DPO/UnB (via Tamburetei UnB)'
            });
        }
        return rows;
    };

    const pasSummaryText =
        data.pas_latest != null
            ? `Sistema Universal: ${formatPasScore(data.pas_latest)}${
                  data.pas_average != null && history.length > 1
                      ? ` · Média: ${formatPasScore(data.pas_average)}`
                      : ''
              }`
            : data.latest_metrics
              ? `DPO ${data.latest_metrics.ano}: ${formatIndicatorNumber(data.latest_metrics.matriculados)} matriculados`
              : 'Ver histórico e indicadores';

    return (
        <Drawer showSwipeHandle>
            <DrawerTrigger
                render={
                    <button
                        type="button"
                        className="mt-3 flex w-full min-w-0 items-center gap-2.5 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-left text-xs transition-colors outline-none hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        <Award className="size-4 shrink-0 text-primary" aria-hidden="true" />
                        <span className="min-w-0 flex-1 wrap-anywhere">
                            <span className="font-semibold text-foreground">
                                {hasPas
                                    ? `Nota de corte PAS (${data.pas_cycle ?? history[0]?.ciclo})`
                                    : 'Indicadores públicos do curso'}
                            </span>
                            <span className="ml-1.5 text-muted-foreground">{pasSummaryText}</span>
                        </span>
                        <ChevronRight
                            className="size-4 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                        />
                    </button>
                }
            />
            <DrawerContent>
                <DrawerHeader>
                    <DrawerTitle>Indicadores públicos · PAS e DPO/UnB</DrawerTitle>
                    <DrawerDescription>
                        Boletins oficiais do PAS (Cebraspe) e métricas institucionais do curso
                        (DPO/UnB).
                    </DrawerDescription>
                </DrawerHeader>
                <div className="flex max-h-[65dvh] flex-col gap-4 overflow-y-auto px-4 pb-2 text-xs">
                    {hasPas && currentPas && (
                        <>
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
                                    Argumentos negativos são válidos. “Não informado” indica
                                    ausência de valor no boletim, não nota zero.
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
                                            onChange={(event) =>
                                                setSelectedCycle(event.target.value)
                                            }
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
                                {currentPdfUrl && (
                                    <a
                                        href={currentPdfUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        referrerPolicy="no-referrer"
                                        className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-4"
                                    >
                                        Boletim Cebraspe · {currentPas.ciclo} (p.{' '}
                                        {currentPas.pagina})
                                        <ExternalLink className="size-3" aria-hidden="true" />
                                    </a>
                                )}
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
                        </>
                    )}

                    {hasDpo && currentMetrics && (
                        <section
                            aria-label="Indicadores institucionais do curso"
                            className="space-y-2"
                        >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                                    <BarChart3 className="size-4 text-primary" aria-hidden="true" />
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
                        </section>
                    )}

                    <section aria-label="Exportar dados públicos do curso" className="space-y-2">
                        <h3 className="text-sm font-semibold text-foreground">Dados abertos</h3>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                    downloadOpenData(
                                        `followw-curso-${slugBase || courseId}`,
                                        buildExportRows(),
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
                                        `followw-curso-${slugBase || courseId}`,
                                        buildExportRows(),
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
                        Fontes: boletins públicos do Cebraspe/UnB e dados agregados do DPO/UnB
                        (compilação aberta pelo projeto{' '}
                        <a
                            href="https://github.com/unb-mds/2026-02-TambureteiUnB"
                            target="_blank"
                            rel="noopener noreferrer"
                            referrerPolicy="no-referrer"
                            className="text-primary underline underline-offset-4"
                        >
                            Tamburetei UnB
                        </a>
                        ).
                    </p>
                </div>
                <DrawerFooter>
                    <DrawerClose render={<Button variant="outline">Fechar</Button>} />
                </DrawerFooter>
            </DrawerContent>
        </Drawer>
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
