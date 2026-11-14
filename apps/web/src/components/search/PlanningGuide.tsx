import { CalendarPlus } from 'lucide-react';

import type { SemesterCalendar } from '#/calendar';
import type { OfferChoice } from '#/lib/offer';

import { Card } from '#/components/ui/card';
import { enrollmentStart } from '#/lib/offer';

const fullDate = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' });

/** O passo a passo para montar a grade ou consultar turmas do semestre selecionado. */
export function PlanningGuide({
    choices,
    selected,
    canPlan = true,
    customCalendar
}: {
    choices: OfferChoice[];
    selected?: string;
    canPlan?: boolean;
    customCalendar?: Record<string, SemesterCalendar>;
}) {
    const next = choices.find((choice) => choice.kind === 'next');
    const current = choices.find((choice) => choice.kind === 'current');
    if (selected && current && selected === current.semester) {
        return (
            <Card size="sm" className="gap-1.5 px-3">
                <p className="flex items-center gap-2 text-sm font-semibold">
                    <CalendarPlus className="size-4 text-primary" aria-hidden="true" />
                    Oferta do semestre atual ({current.semester})
                </p>
                <p className="text-sm text-muted-foreground">
                    {canPlan
                        ? `As recomendações e resultados mostram as turmas de ${current.semester}.`
                        : `Exibindo turmas de ${current.semester} apenas para consulta. Adicionar à grade do semestre atual fica liberado só durante o período de matrícula.`}
                </p>
                {next && !next.available && (
                    <p className="text-xs text-muted-foreground">
                        A oferta de {next.semester} ainda não saiu no SIGAA
                        {enrollmentStart(next.semester, customCalendar)
                            ? `; a matrícula começa em ${fullDate.format(new Date(`${enrollmentStart(next.semester, customCalendar)}T00:00:00Z`))}`
                            : ''}
                        .
                    </p>
                )}
            </Card>
        );
    }
    if (!next) return null;
    const start = enrollmentStart(next.semester, customCalendar);
    return (
        <Card size="sm" className="gap-2 px-3">
            <p className="flex items-center gap-2 text-sm font-semibold">
                <CalendarPlus className="size-4 text-primary" aria-hidden="true" />
                Planejar {next.semester}
            </p>
            {next.available ? (
                <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm text-muted-foreground">
                    <li>
                        As recomendações abaixo já são da oferta de {next.semester} e ignoram o que
                        você concluiu.
                    </li>
                    <li>
                        Abra uma matéria e toque em + na turma para colocá-la na prévia da grade.
                    </li>
                    <li>
                        Você também pode alternar para o semestre atual no seletor ao lado das abas.
                    </li>
                </ol>
            ) : (
                <p className="text-sm text-muted-foreground">
                    A oferta de {next.semester} ainda não foi publicada
                    {start
                        ? `; a matrícula começa em ${fullDate.format(new Date(`${start}T00:00:00Z`))}`
                        : ''}
                    . Até lá, as recomendações usam as turmas do semestre atual.
                </p>
            )}
        </Card>
    );
}
