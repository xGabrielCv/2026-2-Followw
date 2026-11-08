import { CalendarPlus } from 'lucide-react';

import type { OfferChoice } from '#/lib/offer';

import { Card } from '#/components/ui/card';
import { enrollmentStart } from '#/lib/offer';

const fullDate = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' });

/** O passo a passo para montar a grade do próximo semestre, acima das recomendações. */
export function PlanningGuide({ choices }: { choices: OfferChoice[] }) {
    const next = choices.find((choice) => choice.kind === 'next');
    if (!next) return null;
    const start = enrollmentStart(next.semester);
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
                        Para outra matéria, busque pelo nome ou código e escolha {next.semester} em
                        “Turmas de”. No fluxo, “Planejar {next.semester}” leva direto às turmas.
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
