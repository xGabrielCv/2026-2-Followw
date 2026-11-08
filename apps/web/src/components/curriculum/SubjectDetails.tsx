import { noop, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CalendarPlus, CircleCheck, Undo2, X } from 'lucide-react';

import type { AcademicState, FlowSubject } from '#/lib/curriculum/types';

import { useManualCompletion } from '#/components/curriculum/ManualCompletion';
import { Button, buttonVariants } from '#/components/ui/button';
import { DialogClose, DialogDescription, DialogTitle } from '#/components/ui/dialog';
import { requirementGroups } from '#/lib/curriculum/format';
import { stateLabels } from '#/lib/curriculum/model';
import { offerChoices } from '#/lib/offer';
import { useOnline } from '#/lib/online';
import { titleCase } from '#/lib/profile';
import { nowInBrasilia } from '#/lib/schedule';
import { cn } from '#/lib/shadcn';
import { displayedRequirements, offerSemestersQueryOptions } from '#/queries/subjects';

function NameList({ names }: { names: string[] }) {
    return (
        <ul className="flex list-disc flex-col gap-1 pl-4">
            {names.map((name) => (
                <li key={name}>{name}</li>
            ))}
        </ul>
    );
}

// uma alternativa vira lista simples; várias são numeradas, cada uma com suas matérias
function Groups({ groups }: { groups: string[][] }) {
    if (groups.length === 1) return <NameList names={groups[0]} />;
    return (
        <ol className="flex flex-col gap-2">
            {groups.map((names, index) => (
                <li key={names.join('|')} className="flex flex-col gap-1">
                    <span className="text-xs">Alternativa {index + 1}</span>
                    <NameList names={names} />
                </li>
            ))}
        </ol>
    );
}

const list = (groups: string[][] | null) => groups && <Groups groups={groups} />;

export function SubjectDetails({
    subject,
    state,
    unlocks
}: {
    subject: FlowSubject;
    state?: AcademicState;
    unlocks?: FlowSubject[];
}) {
    const displayed = displayedRequirements(subject);
    // como na busca, requisito existente sem alternativa exibida ganha aviso
    const requirements = (key: 'prerequisites' | 'corequisites') =>
        list(requirementGroups(displayed[key])) ??
        (requirementGroups(subject[key]) &&
            'Nenhuma alternativa na matriz ou com turmas no semestre.');
    const sections = [
        { label: 'Pré-requisitos', content: requirements('prerequisites') },
        { label: 'Correquisitos', content: requirements('corequisites') },
        { label: 'Equivalências', content: list(requirementGroups(displayed.equivalences)) },
        {
            label: 'Desbloqueia',
            content: unlocks?.length ? (
                <NameList names={unlocks.map((item) => titleCase(item.name))} />
            ) : null
        }
    ].filter((section) => section.content);
    return (
        <>
            <div className="flex flex-col gap-1">
                <div className="flex items-start gap-2">
                    <DialogTitle className="min-w-0 flex-1">{titleCase(subject.name)}</DialogTitle>
                    <DialogClose
                        render={
                            <Button variant="ghost" size="icon-sm" className="-mt-1 shrink-0" />
                        }
                        aria-label="Fechar detalhes da matéria"
                    >
                        <X className="size-4" aria-hidden="true" />
                    </DialogClose>
                </div>
                <DialogDescription>
                    {state && <>{stateLabels[state]} · </>}
                    {subject.period}º semestre
                </DialogDescription>
            </div>
            {sections.length > 0 && (
                <dl className="flex flex-col gap-4 text-sm">
                    {sections.map(({ label, content }) => (
                        <div key={label}>
                            <dt className="mb-1 font-bold">{label}</dt>
                            <dd className="text-muted-foreground">{content}</dd>
                        </div>
                    ))}
                </dl>
            )}
            <ManualToggle code={subject.code} state={state} />
            <div className="flex flex-col gap-2">
                <NextSemesterLink code={subject.code} state={state} />
                <Link
                    to="/buscar"
                    search={{ q: subject.code, category: 'classrooms' }}
                    className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
                >
                    Turmas do semestre atual
                </Link>
            </div>
        </>
    );
}

/** Para matérias que o histórico não reconhece, como equivalências não cadastradas. */
function ManualToggle({ code, state }: { code: string; state?: AcademicState }) {
    const manual = useManualCompletion();
    const online = useOnline();
    if (!manual || state === 'unknown') return null;
    const marked = manual.codes.has(code);
    // concluída pelo histórico não precisa de marcação
    if (state === 'completed' && !marked) return null;
    return (
        <div className="flex flex-col gap-1">
            <Button
                variant="outline"
                disabled={!online || manual.pending}
                onClick={() => void manual.toggle(code).catch(noop)}
            >
                {marked ? <Undo2 aria-hidden="true" /> : <CircleCheck aria-hidden="true" />}
                {marked ? 'Desmarcar conclusão manual' : 'Marcar como concluída'}
            </Button>
            <p className="text-xs text-muted-foreground">
                {marked
                    ? 'Marcada por você como concluída; o SIGAA não foi alterado.'
                    : 'Use se você cursou uma equivalente que o histórico não reconheceu.'}
            </p>
            {manual.failed && (
                <p role="alert" className="text-xs text-destructive">
                    Não foi possível salvar. Tente novamente.
                </p>
            )}
        </div>
    );
}

/** Leva às turmas do próximo semestre, já prontas para entrar na prévia da grade. */
function NextSemesterLink({ code, state }: { code: string; state?: AcademicState }) {
    const { data: available } = useQuery(offerSemestersQueryOptions);
    const next = offerChoices(available ?? [], nowInBrasilia().date).choices.find(
        (choice) => choice.kind === 'next'
    );
    if (!next || state === 'completed' || state === 'enrolled') return null;
    if (!next.available)
        return (
            <p className="text-xs text-muted-foreground">
                A oferta de {next.semester} ainda não saiu; quando sair, dá para montar a grade
                daqui.
            </p>
        );
    return (
        <Link
            to="/buscar"
            search={{ q: code, category: 'classrooms', semester: next.semester }}
            className={cn(buttonVariants(), 'w-full')}
        >
            <CalendarPlus aria-hidden="true" />
            Planejar {next.semester}: ver turmas e montar grade
        </Link>
    );
}
