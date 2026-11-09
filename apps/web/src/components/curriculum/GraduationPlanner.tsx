import { GraduationCap } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import type { AcademicState, CurriculumModel, FlowSubject } from '#/lib/curriculum/types';

import { SectionHeader } from '#/components/SectionHeader';
import { Badge } from '#/components/ui/badge';
import { planGraduation, SCENARIOS } from '#/lib/curriculum/graduation';
import { projectedSemester } from '#/lib/curriculum/statistics';

const number = new Intl.NumberFormat('pt-BR');

/**
 * Projeção dos semestres que faltam no fluxo obrigatório. É uma estimativa por regras, não uma
 * confirmação de integralização: não considera optativas, complementares, vagas nem a oferta.
 */
export function GraduationPlanner({
    model,
    state,
    semester
}: {
    model: CurriculumModel;
    state: (subject: FlowSubject) => AcademicState;
    // semestre regular em andamento
    semester?: string;
}) {
    const id = useId();
    const [maxSubjects, setMaxSubjects] = useState(5);
    const [failures, setFailures] = useState<string[]>([]);
    const plan = useMemo(
        () => planGraduation(model, state, { maxSubjects, maxHours: null, failures }),
        [model, state, maxSubjects, failures]
    );
    const comparison = useMemo(
        () =>
            SCENARIOS.map(({ id: key, label, scenario: base }) => ({
                key,
                label,
                plan: planGraduation(model, state, { ...base, failures })
            })),
        [model, state, failures]
    );
    // só as matérias que ainda dá para reprovar
    const retakeable = useMemo(
        () =>
            model.subjects
                .filter((subject) => state(subject) !== 'completed')
                .toSorted((a, b) => a.period - b.period || a.code.localeCompare(b.code)),
        [model, state]
    );

    if (plan.remainingSubjects === 0)
        return (
            <section className="flex flex-col gap-2">
                <SectionHeader title="Planejar a formatura" />
                <p className="text-sm text-muted-foreground">
                    O fluxo obrigatório está completo no seu histórico.
                </p>
            </section>
        );

    const end = (terms: number) =>
        semester && terms > 0 ? projectedSemester(semester, terms) : undefined;

    return (
        <section className="flex flex-col gap-3">
            <SectionHeader title="Planejar a formatura" />
            <p className="text-sm text-muted-foreground">
                Estimativa pelo fluxo obrigatório, respeitando pré-requisitos e correquisitos. Não
                inclui optativas, complementares, vagas nem a oferta de cada semestre: não é uma
                confirmação de integralização.
            </p>
            <div className="grid grid-cols-3 gap-2">
                {comparison.map(({ key, label, plan: option }) => (
                    <div
                        key={key}
                        className="flex flex-col gap-1 rounded-xl bg-card p-3 ring-1 ring-foreground/8"
                    >
                        <span className="text-xs text-muted-foreground">{label}</span>
                        <span className="text-lg font-bold">
                            {option.terms.length}{' '}
                            {option.terms.length === 1 ? 'semestre' : 'semestres'}
                        </span>
                        {end(option.terms.length) && (
                            <span className="text-xs text-muted-foreground">
                                até {end(option.terms.length)}
                            </span>
                        )}
                    </div>
                ))}
            </div>
            <p className="text-xs text-muted-foreground">
                Faltam {plan.remainingSubjects} matérias e {number.format(plan.remainingHours)}h do
                fluxo obrigatório.
            </p>
            <div className="flex items-center justify-between gap-2 text-sm">
                <label htmlFor={`${id}-load`} className="font-medium">
                    Matérias por semestre
                </label>
                <select
                    id={`${id}-load`}
                    className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                    value={maxSubjects}
                    onChange={(event) => setMaxSubjects(Number(event.target.value))}
                >
                    {[3, 4, 5, 6, 7, 8].map((count) => (
                        <option key={count} value={count}>
                            {count}
                        </option>
                    ))}
                </select>
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
                <label htmlFor={`${id}-fail`} className="font-medium">
                    E se eu reprovar em…
                </label>
                <select
                    id={`${id}-fail`}
                    className="h-8 max-w-[60%] rounded-lg border border-input bg-background px-2 text-sm"
                    value=""
                    onChange={(event) =>
                        event.target.value &&
                        setFailures(Array.from(new Set([...failures, event.target.value])))
                    }
                >
                    <option value="">Escolha uma matéria</option>
                    {retakeable.map((subject) => (
                        <option key={subject.code} value={subject.code}>
                            {subject.name}
                        </option>
                    ))}
                </select>
            </div>
            {failures.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {failures.map((code) => (
                        <button
                            key={code}
                            type="button"
                            onClick={() => setFailures(failures.filter((entry) => entry !== code))}
                            className="rounded-full bg-destructive/10 px-2 py-1 text-xs text-destructive"
                            aria-label={`Tirar a reprovação em ${model.byCode.get(code)?.name ?? code}`}
                        >
                            {model.byCode.get(code)?.name ?? code} ×
                        </button>
                    ))}
                </div>
            )}
            <ol className="flex flex-col gap-2" aria-label="Semestres simulados">
                {plan.terms.map((term) => (
                    <li
                        key={term.index}
                        className="rounded-xl bg-card p-3 ring-1 ring-foreground/8"
                    >
                        <div className="mb-1 flex items-center justify-between text-sm font-semibold">
                            <span className="flex items-center gap-1">
                                <GraduationCap className="size-4 text-primary" aria-hidden="true" />
                                {semester
                                    ? projectedSemester(semester, term.index)
                                    : `Semestre ${term.index}`}
                            </span>
                            <span className="text-xs font-normal text-muted-foreground">
                                {number.format(term.hours)}h
                            </span>
                        </div>
                        <ul className="text-sm">
                            {term.subjects.map((subject) => (
                                <li key={subject.code}>
                                    {subject.name}{' '}
                                    <span className="text-xs text-muted-foreground">
                                        {subject.code}
                                    </span>
                                </li>
                            ))}
                            {term.failed.map((subject) => (
                                <li key={subject.code} className="text-destructive">
                                    {subject.name}{' '}
                                    <Badge variant="outline">reprova (simulação)</Badge>
                                </li>
                            ))}
                        </ul>
                    </li>
                ))}
            </ol>
            {plan.bottlenecks.length > 0 && (
                <div className="rounded-xl bg-primary/5 p-3 text-sm">
                    <p className="font-semibold">
                        Matérias que mais atrasam se ficarem para depois
                    </p>
                    <ul className="list-disc pl-5 text-muted-foreground">
                        {plan.bottlenecks.map((entry) => (
                            <li key={entry.code}>
                                {entry.name}: libera {entry.unlocks}{' '}
                                {entry.unlocks === 1 ? 'matéria' : 'matérias'}, cadeia de{' '}
                                {entry.chain + 1} semestres
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {plan.blocked.length > 0 && (
                <p role="alert" className="text-xs text-destructive">
                    Não deu para encaixar:{' '}
                    {plan.blocked.map((entry) => `${entry.name} (${entry.reason})`).join('; ')}.
                </p>
            )}
        </section>
    );
}
