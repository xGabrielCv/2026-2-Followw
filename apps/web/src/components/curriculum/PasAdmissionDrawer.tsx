import { useQuery } from '@tanstack/react-query';
import { Award, ChevronRight, ExternalLink } from 'lucide-react';
import { useMemo, useState } from 'react';

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
import {
    formatPasScore,
    getPasHistory,
    loadPasSources,
    type PasCourseQuery
} from '#/lib/pas-admission';

export function PasAdmissionDrawer({ course }: { course: PasCourseQuery }) {
    const { data: sources } = useQuery({
        queryKey: ['public', 'pas-sources'],
        queryFn: loadPasSources,
        staleTime: Infinity,
        gcTime: Infinity
    });
    const [selectedCycle, setSelectedCycle] = useState<string>('');

    const history = useMemo(
        () => (sources ? getPasHistory(course, sources) : []),
        [course, sources]
    );
    const latest = history[0];
    const hasAnyMatch = history.some((entry) => entry.admission !== undefined);

    if (!sources || !hasAnyMatch || !latest) return null;

    const currentEntry =
        history.find((entry) => entry.source.ciclo === selectedCycle) ??
        history.find((entry) => entry.admission !== undefined) ??
        latest;
    const latestAdmission = latest.admission;
    const currentAdmission = currentEntry.admission;
    const currentPdfUrl = `${currentEntry.source.url}${currentAdmission ? `#page=${currentAdmission.pagina}` : ''}`;

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
                                Nota de corte PAS ({latest.source.ciclo})
                            </span>
                            <span className="ml-1.5 text-muted-foreground">
                                {latestAdmission
                                    ? `Sistema Universal: ${formatPasScore(latestAdmission.minimo)}`
                                    : 'Ver histórico e cotas'}
                            </span>
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
                    <DrawerTitle>Notas de corte do PAS · UnB</DrawerTitle>
                    <DrawerDescription>
                        Menor argumento final dos selecionados nos boletins oficiais do Cebraspe.
                    </DrawerDescription>
                </DrawerHeader>
                <div className="flex max-h-[65dvh] flex-col gap-4 overflow-y-auto px-4 pb-2 text-xs">
                    <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <div className="min-w-0">
                                <p className="font-semibold text-primary">
                                    PAS {latest.source.ciclo} · Sistema Universal
                                </p>
                                {latestAdmission?.ingressoConjunto && (
                                    <p className="mt-0.5 text-muted-foreground">
                                        Ingresso conjunto das Engenharias do Gama (FCTE)
                                    </p>
                                )}
                            </div>
                            <strong className="text-xl font-bold text-primary tabular-nums">
                                {latestAdmission
                                    ? formatPasScore(latestAdmission.minimo)
                                    : 'Não disponível'}
                            </strong>
                        </div>
                        <p className="mt-2 leading-relaxed text-muted-foreground">
                            Argumentos negativos são válidos. “Não informado” indica ausência de
                            valor no boletim, não nota zero.
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
                                    value={currentEntry.source.ciclo}
                                    onChange={(event) => setSelectedCycle(event.target.value)}
                                    className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground"
                                >
                                    {history.map((entry) => (
                                        <option key={entry.source.ciclo} value={entry.source.ciclo}>
                                            {entry.source.ciclo}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </div>
                        {currentAdmission ? (
                            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                                {currentEntry.source.modalidades.map((modality) => {
                                    const score = currentAdmission.cotas?.[modality.id];
                                    return (
                                        <li key={modality.id} className="p-3">
                                            <p className="text-[11px] text-muted-foreground">
                                                {modality.sistema}
                                            </p>
                                            <p className="mt-0.5 font-semibold wrap-anywhere text-foreground">
                                                {modality.descricao}
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
                        ) : (
                            <p className="rounded-xl border border-border p-3 text-muted-foreground">
                                Sem oferta validada no boletim do ciclo {currentEntry.source.ciclo}.
                            </p>
                        )}
                        <a
                            href={currentPdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            referrerPolicy="no-referrer"
                            className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-4"
                        >
                            Boletim Cebraspe · {currentEntry.source.ciclo}
                            {currentAdmission ? ` (p. ${currentAdmission.pagina})` : ''}
                            <ExternalLink className="size-3" aria-hidden="true" />
                        </a>
                    </section>

                    <section aria-label="Histórico por ciclo" className="space-y-2">
                        <h3 className="text-sm font-semibold text-foreground">
                            Histórico ({history.length} ciclos)
                        </h3>
                        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                            {history.map(({ source, admission }) => (
                                <li
                                    key={source.ciclo}
                                    className="flex items-center justify-between gap-3 px-3 py-2"
                                >
                                    <div className="min-w-0">
                                        <p className="font-semibold text-foreground">
                                            {source.ciclo}
                                        </p>
                                        {admission?.ingressoConjunto && (
                                            <p className="text-[11px] text-muted-foreground">
                                                Ingresso conjunto (FCTE)
                                            </p>
                                        )}
                                    </div>
                                    <span className="shrink-0 font-bold text-foreground tabular-nums">
                                        {admission
                                            ? formatPasScore(admission.minimo)
                                            : 'Não disponível'}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </section>

                    <p className="text-[11px] text-muted-foreground">
                        Fonte: boletins públicos do Cebraspe/UnB (compilação aberta pelo projeto{' '}
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
