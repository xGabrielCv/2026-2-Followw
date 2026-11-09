import { Sparkles } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import type { PlannedClass, SchedulePlan } from '#/lib/planned-schedule';
import type { Result, Shift, Weight } from '#/lib/schedule-optimizer';

import { Button } from '#/components/ui/button';
import { Checkbox } from '#/components/ui/checkbox';
import { createPlan, MAX_PLANS, plannedSchedule } from '#/lib/planned-schedule';
import { describeSchedule, WEEKDAYS_SHORT } from '#/lib/schedule';
import {
    DEFAULT_PREFERENCES,
    SHIFT_LABELS,
    suggestSchedules,
    subjectsFromPlans
} from '#/lib/schedule-optimizer';

const WEIGHT_LABELS: Record<Weight, string> = { 0: 'Ignorar', 1: 'Pouco', 2: 'Normal', 3: 'Muito' };
const CRITERIA = [
    ['fewerDays', 'Menos dias no campus'],
    ['fewerGaps', 'Menos janelas entre aulas'],
    ['avoidShifts', 'Evitar os turnos marcados'],
    ['balance', 'Carga equilibrada nos dias'],
    ['progress', 'Encaixar as matérias opcionais']
] as const;
const SHIFTS: Shift[] = ['morning', 'afternoon', 'night'];
const WORKDAYS = [1, 2, 3, 4, 5, 6];

const toggle = <T,>(list: T[], value: T) =>
    list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];

/**
 * Simulador 2.0: monta grades sem choque a partir das turmas que o aluno já pôs nas suas grades do
 * semestre e ordena pelas preferências. Tudo roda no aparelho; não promete vaga.
 */
export function SuggestedPlans({
    plans,
    semester,
    maxHours
}: {
    plans: SchedulePlan[];
    semester: string;
    maxHours: number | null;
}) {
    const id = useId();
    const pool = useMemo(
        () =>
            plans
                .flatMap((plan) => plan.items)
                .filter((item): item is PlannedClass => item.semester === semester),
        [plans, semester]
    );
    const [optional, setOptional] = useState<Set<string>>(new Set());
    const [blocked, setBlocked] = useState<number[]>([]);
    const [avoid, setAvoid] = useState<Shift[]>([]);
    const [weights, setWeights] = useState(DEFAULT_PREFERENCES.weights);
    const [result, setResult] = useState<Result | null>(null);
    const subjects = useMemo(() => subjectsFromPlans(pool, optional), [pool, optional]);

    if (subjects.length < 2) return null;

    const run = () =>
        setResult(
            suggestSchedules(subjects, {
                ...DEFAULT_PREFERENCES,
                blockedWeekdays: blocked,
                avoidShifts: avoid,
                weights,
                maxHours
            })
        );
    return (
        <section className="flex flex-col gap-3 rounded-2xl bg-card p-4 ring-1 ring-foreground/8">
            <h2 className="flex items-center gap-2 text-base font-semibold">
                <Sparkles className="size-4 text-primary" aria-hidden="true" />
                Sugerir grades
            </h2>
            <p className="text-sm text-muted-foreground">
                Usa as turmas que você já colocou nas suas grades de {semester}: cada matéria pode
                ter várias turmas de opção. O app monta combinações sem choque e explica a escolha.
                Não sabe de vagas nem de pré-requisitos.
            </p>
            <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">Matérias</legend>
                {subjects.map((subject) => (
                    <label key={subject.code} className="flex items-center gap-2 text-sm">
                        <Checkbox
                            checked={subject.required}
                            onCheckedChange={() =>
                                setOptional(new Set(toggle([...optional], subject.code)))
                            }
                            aria-label={`${subject.name} é obrigatória`}
                        />
                        <span className="min-w-0 flex-1 truncate">
                            {subject.name}{' '}
                            <span className="text-muted-foreground">
                                · {subject.options.length}{' '}
                                {subject.options.length === 1 ? 'turma' : 'turmas'}
                            </span>
                        </span>
                        <span className="text-xs text-muted-foreground">
                            {subject.required ? 'obrigatória' : 'opcional'}
                        </span>
                    </label>
                ))}
            </fieldset>
            <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">Não posso ir</legend>
                <div className="flex flex-wrap gap-2">
                    {WORKDAYS.map((day) => (
                        <label key={day} className="flex items-center gap-1 text-sm">
                            <Checkbox
                                checked={blocked.includes(day)}
                                onCheckedChange={() => setBlocked(toggle(blocked, day))}
                                aria-label={`Não posso ir ${WEEKDAYS_SHORT[day]}`}
                            />
                            {WEEKDAYS_SHORT[day]}
                        </label>
                    ))}
                </div>
            </fieldset>
            <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-medium">Evitar turnos</legend>
                <div className="flex flex-wrap gap-3">
                    {SHIFTS.map((shift) => (
                        <label key={shift} className="flex items-center gap-1 text-sm">
                            <Checkbox
                                checked={avoid.includes(shift)}
                                onCheckedChange={() => setAvoid(toggle(avoid, shift))}
                                aria-label={`Evitar ${SHIFT_LABELS[shift]}`}
                            />
                            {SHIFT_LABELS[shift]}
                        </label>
                    ))}
                </div>
            </fieldset>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {CRITERIA.map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between gap-2 text-sm">
                        <label htmlFor={`${id}-${key}`}>{label}</label>
                        <select
                            id={`${id}-${key}`}
                            className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                            value={weights[key]}
                            onChange={(event) =>
                                setWeights({ ...weights, [key]: Number(event.target.value) })
                            }
                        >
                            {([0, 1, 2, 3] as const).map((weight) => (
                                <option key={weight} value={weight}>
                                    {WEIGHT_LABELS[weight]}
                                </option>
                            ))}
                        </select>
                    </div>
                ))}
            </div>
            <Button onClick={run} className="self-start">
                <Sparkles aria-hidden="true" />
                Sugerir grades
            </Button>
            {result && <Suggestions result={result} planCount={plans.length} />}
        </section>
    );
}

function Suggestions({ result, planCount }: { result: Result; planCount: number }) {
    if (result.impossible.length)
        return (
            <div role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm">
                <p className="font-semibold">Não existe grade com essas matérias obrigatórias:</p>
                <ul className="list-disc pl-5">
                    {result.impossible.map((entry) => (
                        <li key={entry.code}>
                            {entry.name} ({entry.code}): {entry.reason}
                        </li>
                    ))}
                </ul>
                <p className="mt-1 text-muted-foreground">
                    Marque uma delas como opcional, adicione outra turma ou libere um dia.
                </p>
            </div>
        );
    if (result.suggestions.length === 0)
        return <p className="text-sm text-muted-foreground">Nenhuma combinação sem choque.</p>;
    return (
        <div className="flex flex-col gap-3">
            {result.truncated && (
                <p className="text-xs text-muted-foreground">
                    Há muitas combinações: mostrei as melhores que deu para conferir rápido.
                </p>
            )}
            {result.suggestions.map((suggestion, index) => (
                <article
                    key={suggestion.items.map((item) => `${item.code}-${item.number}`).join('|')}
                    className="flex flex-col gap-2 rounded-xl bg-muted/50 p-3"
                >
                    <h3 className="text-sm font-semibold">Opção {index + 1}</h3>
                    <ul className="text-xs text-muted-foreground">
                        {suggestion.reasons.map((reason) => (
                            <li key={reason}>• {reason}</li>
                        ))}
                    </ul>
                    <ul className="flex flex-col gap-1 text-sm">
                        {suggestion.items.map((item) => (
                            <li key={`${item.code}-${item.number}`}>
                                {item.name} · turma {item.number}{' '}
                                <span className="text-muted-foreground">
                                    {describeSchedule(item.schedule) ?? 'horário a definir'}
                                </span>
                            </li>
                        ))}
                    </ul>
                    {suggestion.left.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                            Ficaram de fora:{' '}
                            {suggestion.left.map((e) => `${e.name} (${e.reason})`).join('; ')}.
                        </p>
                    )}
                    <Button
                        size="sm"
                        variant="outline"
                        className="self-start"
                        disabled={planCount >= MAX_PLANS}
                        onClick={() => {
                            if (createPlan()) plannedSchedule.set(suggestion.items);
                        }}
                    >
                        {planCount >= MAX_PLANS ? 'Limite de grades' : 'Usar esta grade'}
                    </Button>
                </article>
            ))}
        </div>
    );
}
