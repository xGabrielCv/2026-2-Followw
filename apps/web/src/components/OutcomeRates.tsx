import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import type { OutcomeRates, ProfessorOutcome } from '#/queries/outcomes';
import type { RatingSummary } from '#/queries/reviews';

import { RatingBadge, useProfessorRatings } from '#/components/community/RatingBadge';
import { Button } from '#/components/ui/button';
import { titleCase } from '#/lib/profile';
import { cn } from '#/lib/shadcn';
import {
    nameKey,
    professorOutcomesQueryOptions,
    subjectOutcomesQueryOptions
} from '#/queries/outcomes';

const percent = (value: number) =>
    `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const turmas = (count: number) => `${count} ${count === 1 ? 'turma' : 'turmas'}`;

// reprovação a partir da qual o índice ganha destaque
const HIGH_FAILURE = 25;
const MEDIUM_FAILURE = 10;

const failureTone = (failed: number) =>
    failed >= HIGH_FAILURE
        ? 'text-destructive'
        : failed >= MEDIUM_FAILURE
          ? 'text-warning'
          : 'text-primary';

const NO_NAMES: string[] = [];

const NOTE =
    'Médias das turmas de alunos do Followw que compartilham os índices no perfil; o SIGAA só mostra a estatística a quem cursou a turma.';

/** A barra de aprovados, reprovados e trancados, com a reprovação em destaque. */
export function RateBar({ label, rates }: { label: string; rates: OutcomeRates }) {
    const rest = Math.max(0, 100 - rates.approved - rates.failed - rates.dropped);
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate font-medium">{label}</span>
                <span
                    className={cn('shrink-0 font-semibold tabular-nums', failureTone(rates.failed))}
                >
                    {percent(rates.failed)} reprovação
                </span>
            </div>
            <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
                <span className="bg-primary" style={{ flexGrow: rates.approved }} />
                <span className="bg-destructive" style={{ flexGrow: rates.failed }} />
                <span className="bg-muted-foreground/50" style={{ flexGrow: rates.dropped }} />
                <span className="bg-muted" style={{ flexGrow: rest }} />
            </div>
            <span className="text-xs text-muted-foreground">
                {percent(rates.approved)} aprovação · {percent(rates.dropped)} trancamento · em{' '}
                {turmas(rates.classrooms)}
            </span>
        </div>
    );
}

function ProfessorRow({
    professor,
    rating
}: {
    professor: ProfessorOutcome;
    rating?: RatingSummary;
}) {
    const name = titleCase(professor.name);
    const label = professor.siape ? (
        <Link
            to="/professores/$siape"
            params={{ siape: professor.siape }}
            className="font-medium hover:text-primary hover:underline"
        >
            {name}
        </Link>
    ) : (
        name
    );
    return (
        <li className="flex flex-col gap-1 py-2.5">
            <span className="flex flex-wrap items-center gap-1.5 text-sm">
                {label}
                <RatingBadge rating={rating} />
            </span>
            {professor.subject ? (
                <RateBar label="Nesta matéria" rates={professor.subject} />
            ) : (
                <span className="text-xs text-muted-foreground">Sem dados nesta matéria.</span>
            )}
            {professor.overall &&
                professor.overall.classrooms !== professor.subject?.classrooms && (
                    <span className="text-xs text-muted-foreground">
                        Geral do docente:{' '}
                        <span
                            className={cn('font-semibold', failureTone(professor.overall.failed))}
                        >
                            {percent(professor.overall.failed)} reprovação
                        </span>{' '}
                        em {turmas(professor.overall.classrooms)}
                    </span>
                )}
        </li>
    );
}

// docentes com dados primeiro, da menor reprovação à maior: o mais "tranquilo" no topo
const byFailure = (a: ProfessorOutcome, b: ProfessorOutcome) =>
    (a.subject?.failed ?? a.overall?.failed ?? Infinity) -
    (b.subject?.failed ?? b.overall?.failed ?? Infinity);

/** Reprovação da matéria e dos docentes; `professors` destaca os da turma vista. */
export function SubjectOutcomesSection({
    code,
    professors = NO_NAMES
}: {
    code: string;
    professors?: string[];
}) {
    const query = useQuery(subjectOutcomesQueryOptions(code));
    const [all, setAll] = useState(false);
    const ratings = useProfessorRatings((query.data?.professors ?? []).map(({ siape }) => siape));
    if (query.isPending)
        return <p className="text-sm text-muted-foreground">Carregando índices de reprovação…</p>;
    if (query.isError)
        return (
            <p className="text-sm text-muted-foreground">Índices de reprovação indisponíveis.</p>
        );

    const keys = new Set(professors.map(nameKey));
    const list = query.data.professors.toSorted(byFailure);
    const ofClassroom = list.filter((item) => keys.has(nameKey(item.name)));
    const shown = all || ofClassroom.length === 0 ? list : ofClassroom;
    const withData = list.filter((item) => item.subject).length;

    return (
        <section
            aria-label="Índices de reprovação"
            className="flex flex-col gap-3 rounded-xl border p-4"
        >
            <h3 className="text-sm font-semibold">Aprovação e reprovação</h3>
            {query.data.subject ? (
                <RateBar label="Matéria, todos os docentes" rates={query.data.subject} />
            ) : (
                <p className="text-sm text-muted-foreground">Ainda não há dados desta matéria.</p>
            )}
            {shown.length > 0 && (
                <ul className="flex flex-col divide-y">
                    {shown.map((professor) => (
                        <ProfessorRow
                            key={professor.name}
                            professor={professor}
                            rating={professor.siape == null ? undefined : ratings[professor.siape]}
                        />
                    ))}
                </ul>
            )}
            {ofClassroom.length > 0 && list.length > ofClassroom.length && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="self-start"
                    onClick={() => setAll(!all)}
                >
                    {all
                        ? 'Só os docentes desta turma'
                        : `Comparar com os ${list.length} docentes da matéria (${withData} com dados)`}
                </Button>
            )}
            <p className="text-xs text-muted-foreground">{NOTE}</p>
        </section>
    );
}

/** No perfil do docente: o índice geral e o de cada matéria com dados. */
export function ProfessorOutcomesSection({ siape }: { siape: number }) {
    const query = useQuery(professorOutcomesQueryOptions(siape));
    if (!query.data) return null;
    const { overall, subjects } = query.data;
    return (
        <section
            aria-label="Índices de reprovação"
            className="flex flex-col gap-3 rounded-2xl bg-card p-4"
        >
            <h2 className="text-base font-semibold">Aprovação e reprovação</h2>
            {overall ? (
                <>
                    <RateBar label="Média em todas as matérias" rates={overall} />
                    <ul className="flex flex-col gap-3">
                        {subjects
                            .toSorted((a, b) => b.rates.failed - a.rates.failed)
                            .map((subject) => (
                                <li key={subject.code}>
                                    <RateBar
                                        label={`${subject.code} · ${titleCase(subject.name)}`}
                                        rates={subject.rates}
                                    />
                                </li>
                            ))}
                    </ul>
                </>
            ) : (
                <p className="text-sm text-muted-foreground">
                    Ainda não há turmas deste docente com estatísticas sincronizadas.
                </p>
            )}
            <p className="text-xs text-muted-foreground">{NOTE}</p>
        </section>
    );
}
