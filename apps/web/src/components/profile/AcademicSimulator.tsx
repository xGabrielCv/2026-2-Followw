import { ChevronDown } from 'lucide-react';
import { lazy, Suspense, useSyncExternalStore } from 'react';

import type { Grade } from '#/lib/academic-simulation';
import type { Classroom } from '#/queries/classrooms';

import { LoadingText } from '#/components/LoadingText';
import { Button } from '#/components/ui/button';
import { Card } from '#/components/ui/card';
import {
    evolutionChartPoints,
    gradeWeights,
    isFreeModule,
    isGrade,
    simulateIndexes,
    simulatedGrades,
    simulationClassrooms,
    simulationGrade,
    simulationKey
} from '#/lib/academic-simulation';
import { groupBySemester } from '#/lib/classroom-details';
import { formatAcademicIndex, titleCase } from '#/lib/profile';
import { cn } from '#/lib/shadcn';

const AcademicSimulatorChart = lazy(() =>
    import('#/components/profile/AcademicSimulatorChart').then((module) => ({
        default: module.AcademicSimulatorChart
    }))
);

const displayIndex = (value: number | null) => (value === null ? '—' : formatAcademicIndex(value));

function futureTone(baseline: number | null, simulated: number | null) {
    if (simulated === null) return 'text-muted-foreground';
    if (baseline !== null && simulated < baseline - 1e-9) return 'text-destructive';
    return 'text-success';
}

function changeGrade(classroom: Classroom, grade: Grade | null) {
    const next = { ...simulatedGrades.getSnapshot() };
    const key = simulationKey(classroom);
    if (grade === (classroom.grade ?? null)) delete next[key];
    else next[key] = grade;
    simulatedGrades.set(next);
}

export function AcademicSimulator({
    classrooms,
    entry,
    current,
    curriculum,
    onIntegralization
}: {
    classrooms: Classroom[];
    entry: string | null;
    current: string | undefined;
    curriculum: Set<string> | null;
    onIntegralization?: () => void;
}) {
    const overrides = useSyncExternalStore(
        simulatedGrades.subscribe,
        simulatedGrades.getSnapshot,
        simulatedGrades.getServerSnapshot
    );
    const groups = groupBySemester(simulationClassrooms(classrooms, entry, current));
    const currentClassrooms = groups.find(([semester]) => semester === current)?.[1] ?? [];
    const previous = groups.filter(([semester]) => semester !== current);
    const baseline = simulateIndexes(groups, entry, current, curriculum, {});
    const { ira, mp, evolution } = simulateIndexes(groups, entry, current, curriculum, overrides);
    const hasSimulation = groups.some(([, items]) =>
        items.some((classroom) => simulationKey(classroom) in overrides)
    );
    const chartData = evolutionChartPoints(evolution);
    const projected = evolution.at(-1)?.projected === true;
    const projectedIndex = evolution.findIndex((point) => point.projected);
    const projectedPoint = projectedIndex >= 0 ? evolution[projectedIndex] : undefined;
    const comparisonIra = projectedIndex > 0 ? evolution[projectedIndex - 1].ira : baseline.ira;
    const projectedDropped =
        projectedPoint !== undefined &&
        comparisonIra !== null &&
        projectedPoint.ira < comparisonIra - 1e-9;
    function rows(items: Classroom[]) {
        return (
            <ul className="divide-y divide-border">
                {items.map((classroom) => {
                    const name = titleCase(classroom.subject.name);
                    return (
                        <li key={simulationKey(classroom)}>
                            <label className="flex min-h-14 items-center justify-between gap-3 px-4 py-2">
                                <span className="flex min-w-0 flex-col gap-0.5">
                                    <span className="font-medium wrap-anywhere">{name}</span>
                                    {isFreeModule(classroom, curriculum) && (
                                        <span className="text-xs text-muted-foreground">
                                            Módulo livre
                                        </span>
                                    )}
                                </span>
                                <select
                                    aria-label={`Menção de ${name}, ${classroom.semester}`}
                                    className="h-9 shrink-0 rounded-lg border border-input bg-background px-2 text-sm focus-visible:ring-3 focus-visible:ring-ring/50"
                                    value={simulationGrade(classroom, overrides) ?? ''}
                                    onChange={(event) => {
                                        const value = event.currentTarget.value;
                                        changeGrade(classroom, isGrade(value) ? value : null);
                                    }}
                                >
                                    <option value="">Sem menção</option>
                                    {Object.keys(gradeWeights).map((grade) => (
                                        <option key={grade} value={grade}>
                                            {grade}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </li>
                    );
                })}
            </ul>
        );
    }

    return (
        <div className="my-4 flex flex-col gap-4">
            <Card className="gap-3 px-4">
                <p className="text-xs text-muted-foreground">
                    Projeção indicativa: não inclui penalidades de trancamento nem ajustes de
                    equivalências. Pode diferir dos índices oficiais do SIGAA. As menções simuladas
                    ficam somente neste navegador, cifradas por conta.
                </p>
                <div className="flex flex-col gap-3" aria-live="polite">
                    <dl className="grid grid-cols-2 gap-4">
                        <div>
                            <dt className="text-muted-foreground">IRA atual</dt>
                            <dd className="text-2xl font-semibold text-info tabular-nums">
                                {displayIndex(baseline.ira)}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-muted-foreground">MP atual</dt>
                            <dd className="text-2xl font-semibold text-info tabular-nums">
                                {displayIndex(baseline.mp)}
                            </dd>
                        </div>
                    </dl>
                    {hasSimulation && (
                        <dl className="grid grid-cols-2 gap-4 border-t border-border pt-3">
                            <div>
                                <dt className="text-muted-foreground">IRA futuro</dt>
                                <dd
                                    className={cn(
                                        'text-2xl font-semibold tabular-nums',
                                        futureTone(baseline.ira, ira)
                                    )}
                                >
                                    {displayIndex(ira)}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-muted-foreground">MP futuro</dt>
                                <dd
                                    className={cn(
                                        'text-2xl font-semibold tabular-nums',
                                        futureTone(baseline.mp, mp)
                                    )}
                                >
                                    {displayIndex(mp)}
                                </dd>
                            </div>
                        </dl>
                    )}
                </div>
                {!entry && (
                    <p className="text-xs text-muted-foreground">
                        IRA indisponível sem o semestre de ingresso.
                    </p>
                )}
                {!curriculum && (
                    <p className="text-xs text-muted-foreground">
                        MP indisponível sem a matriz curricular.
                    </p>
                )}
                <Button
                    type="button"
                    variant="outline"
                    className="self-start"
                    disabled={Object.keys(overrides).length === 0}
                    onClick={simulatedGrades.clear}
                >
                    Limpar simulação
                </Button>
            </Card>
            <section aria-labelledby="simulator-current">
                <h2 id="simulator-current" className="mb-2 px-1 text-sm font-semibold">
                    Semestre atual{current && ` · ${current}`}
                </h2>
                <Card className="py-0">
                    {currentClassrooms.length ? (
                        rows(currentClassrooms)
                    ) : (
                        <p className="p-4 text-muted-foreground">
                            Nenhuma disciplina no semestre atual.
                        </p>
                    )}
                </Card>
            </section>
            {previous.length > 0 && (
                <details className="group overflow-hidden rounded-2xl bg-card text-sm shadow-card ring-1 ring-foreground/8">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 font-semibold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset">
                        Semestres anteriores
                        <ChevronDown
                            className="size-4 text-muted-foreground group-open:rotate-180"
                            aria-hidden="true"
                        />
                    </summary>
                    {previous.map(([semester, items]) => (
                        <section key={semester} className="border-t border-border">
                            <h3 className="px-4 pt-3 text-sm font-semibold">{semester}</h3>
                            {rows(items)}
                        </section>
                    ))}
                </details>
            )}
            <section aria-labelledby="simulator-evolution">
                <h2 id="simulator-evolution" className="mb-2 px-1 text-sm font-semibold">
                    Evolução do IRA
                </h2>
                <Card className="gap-2 px-4">
                    {evolution.length === 0 ? (
                        <p className="text-muted-foreground">
                            A evolução aparece quando houver menções para calcular o IRA.
                        </p>
                    ) : (
                        <Suspense fallback={<LoadingText>Carregando gráfico...</LoadingText>}>
                            <AcademicSimulatorChart
                                chartData={chartData}
                                current={current}
                                projected={projected}
                                projectedDropped={projectedDropped}
                            />
                        </Suspense>
                    )}
                    {projected && (
                        <p
                            className={cn(
                                'flex items-center gap-1.5 text-xs',
                                projectedDropped ? 'text-destructive' : 'text-success'
                            )}
                        >
                            <span
                                className={cn(
                                    'inline-block size-2 rounded-full',
                                    projectedDropped ? 'bg-destructive' : 'bg-success'
                                )}
                                aria-hidden="true"
                            />
                            * Projeção para {current}.
                        </p>
                    )}
                </Card>
            </section>
            {onIntegralization && (
                <Button variant="outline" className="w-full" onClick={onIntegralization}>
                    Calcular integralização futura
                </Button>
            )}
        </div>
    );
}
