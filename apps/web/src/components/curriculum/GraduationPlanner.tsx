import { GraduationCap } from 'lucide-react';
import { useId, useMemo, useSyncExternalStore } from 'react';

import type { AcademicState, CurriculumModel, FlowSubject } from '#/lib/curriculum/types';
import type { CourseCurriculum } from '#/queries/curriculum';
import type { UserProfile } from '#/queries/me';

import { SectionHeader } from '#/components/SectionHeader';
import { Badge } from '#/components/ui/badge';
import { planningModel, planGraduation, SCENARIOS } from '#/lib/curriculum/graduation';
import { projectedSemester } from '#/lib/curriculum/statistics';
import { accountStore, flushLocalStorage } from '#/lib/local-storage';
import { titleCase } from '#/lib/profile';

const number = new Intl.NumberFormat('pt-BR');

/**
 * Cenários locais por regras, incluindo disciplinas extras escolhidas; não confirma integralização.
 */
export function GraduationPlanner({
    model: requiredModel,
    state,
    semester,
    registration,
    curriculum,
    workload,
    maxWorkload,
    completedCodes
}: {
    model: CurriculumModel;
    state: (subject: FlowSubject) => AcademicState;
    // semestre regular em andamento
    semester?: string;
    registration: string;
    curriculum: CourseCurriculum;
    workload: UserProfile['workload'];
    maxWorkload: number | null;
    completedCodes: string[];
}) {
    const id = useId();
    const store = useMemo(
        () =>
            accountStore(`graduation:${registration}:${curriculum.course_id}`, {
                maxSubjects: 5,
                maxHours: maxWorkload,
                failures: [] as string[],
                extras: [] as string[]
            }),
        [registration, curriculum.course_id, maxWorkload]
    );
    const preferences = useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getServerSnapshot
    );
    const { maxSubjects, maxHours, failures, extras } = preferences;
    const save = (next: Partial<typeof preferences>) => {
        store.set({ ...store.getSnapshot(), ...next });
        void flushLocalStorage().catch(() => {});
    };
    const setMaxSubjects = (value: number) => save({ maxSubjects: value });
    const setFailures = (value: string[]) => save({ failures: value });
    const model = useMemo(
        () => (extras.length ? planningModel(curriculum, extras) : requiredModel),
        [curriculum, extras, requiredModel]
    );
    const additional = useMemo(
        () =>
            [
                ...new Map(
                    [
                        ...curriculum.periods
                            .filter((block) => block.period === 0)
                            .flatMap((block) => block.subjects),
                        ...curriculum.complementary
                    ].map((subject) => [subject.code, subject])
                ).values()
            ].filter((subject) => subject.name && !requiredModel.byCode.has(subject.code)),
        [curriculum, requiredModel]
    );
    const plan = useMemo(
        () => planGraduation(model, state, { maxSubjects, maxHours, failures, completedCodes }),
        [model, state, maxSubjects, maxHours, failures, completedCodes]
    );
    const comparison = useMemo(
        () =>
            SCENARIOS.map(({ id: key, label, scenario: base }) => ({
                key,
                label,
                plan: planGraduation(model, state, { ...base, maxHours, failures, completedCodes })
            })),
        [model, state, maxHours, failures, completedCodes]
    );
    // só as matérias que ainda dá para reprovar
    const retakeable = useMemo(
        () =>
            model.subjects
                .filter((subject) => state(subject) !== 'completed')
                .toSorted((a, b) => a.period - b.period || a.code.localeCompare(b.code)),
        [model, state]
    );

    const end = (terms: number) =>
        semester && terms > 0 ? projectedSemester(semester, terms) : undefined;

    return (
        <section className="flex flex-col gap-3">
            <SectionHeader title="Planejar a formatura" />
            {plan.remainingSubjects === 0 && (
                <p className="text-sm text-muted-foreground">
                    O conjunto de disciplinas selecionadas está completo. Confira também as
                    pendências do SIGAA abaixo.
                </p>
            )}
            <p className="text-sm text-muted-foreground">
                Estimativa pelas disciplinas selecionadas, respeitando requisitos confirmados e
                correquisitos. Oferta, vagas e validação de atividades complementares dependem da
                UnB. Não é uma confirmação de integralização.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {[
                    ['Obrigatórias pendentes no SIGAA', workload?.pending_mandatory],
                    ['Optativas pendentes no SIGAA', workload?.pending_optional],
                    ['Complementares pendentes no SIGAA', workload?.pending_complementary]
                ].map(([label, hours]) => (
                    <div key={label} className="rounded-xl bg-card p-3 ring-1 ring-foreground/8">
                        <p className="text-xs text-muted-foreground">{label}</p>
                        <p className="text-lg font-bold">
                            {typeof hours === 'number'
                                ? `${number.format(hours)}h`
                                : 'Não informado'}
                        </p>
                    </div>
                ))}
            </div>
            <p className="text-xs text-muted-foreground">
                Pendências acima vêm do perfil do SIGAA e não mudam com esta simulação. Marcações
                manuais precisam de confirmação oficial.
            </p>
            {additional.length > 0 && (
                <details className="rounded-xl bg-card p-3 ring-1 ring-foreground/8">
                    <summary className="cursor-pointer text-sm font-semibold">
                        Incluir optativas e componentes complementares
                    </summary>
                    <p className="my-2 text-xs text-muted-foreground">
                        Escolha disciplinas da matriz. Atividades sem disciplina ou carga informada
                        não têm prazo calculável aqui.
                    </p>
                    <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
                        {additional.map((subject) => (
                            <label key={subject.code} className="flex items-start gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    className="mt-1 accent-primary"
                                    checked={extras.includes(subject.code)}
                                    onChange={() =>
                                        save({
                                            extras: extras.includes(subject.code)
                                                ? extras.filter((code) => code !== subject.code)
                                                : [...extras, subject.code]
                                        })
                                    }
                                />
                                <span>
                                    {titleCase(subject.name ?? subject.code)} · {subject.code} ·{' '}
                                    {subject.hours == null
                                        ? 'carga indisponível'
                                        : `${subject.hours}h`}
                                </span>
                            </label>
                        ))}
                    </div>
                </details>
            )}
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
                conjunto de disciplinas selecionadas.
            </p>
            <div className="flex items-center justify-between gap-2 text-sm">
                <label htmlFor={`${id}-hours`} className="font-medium">
                    Horas por semestre
                </label>
                <input
                    id={`${id}-hours`}
                    type="number"
                    min="30"
                    max={maxWorkload ?? 1000}
                    step="30"
                    value={maxHours ?? ''}
                    onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!event.target.value) save({ maxHours: null });
                        else if (
                            Number.isFinite(value) &&
                            value >= 30 &&
                            value <= (maxWorkload ?? 1000)
                        )
                            save({ maxHours: value });
                    }}
                    className="h-8 w-24 rounded-lg border border-input bg-background px-2"
                />
            </div>
            <p className="text-xs text-muted-foreground">
                Preferências desta simulação ficam cifradas neste navegador, separadas por conta.
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
