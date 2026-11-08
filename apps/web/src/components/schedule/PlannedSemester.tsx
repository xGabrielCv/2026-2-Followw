import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CalendarPlus, Search } from 'lucide-react';

import { PlannedClassList } from '#/components/schedule/PlannedClassList';
import { usePlannedSchedule } from '#/components/schedule/usePlannedSchedule';
import { WeeklyTable } from '#/components/schedule/WeeklyTable';
import { buttonVariants } from '#/components/ui/button';
import { Card } from '#/components/ui/card';
import { enrollmentStart } from '#/lib/offer';
import { weeklyGrid } from '#/lib/planned-schedule';
import { cn } from '#/lib/shadcn';
import { offerSemestersQueryOptions } from '#/queries/subjects';

const fullDate = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' });

/**
 * A prévia da grade do próximo semestre em Minhas Turmas: a mesma montada na busca, então
 * tirar uma turma aqui tira lá, e o que se adiciona lá aparece aqui.
 */
export function PlannedSemester({ semester }: { semester: string }) {
    const { items, maxHours, toggle } = usePlannedSchedule();
    const { data: offer } = useQuery(offerSemestersQueryOptions);
    const published = offer?.includes(semester) ?? false;
    const planned = items.filter((item) => item.semester === semester);
    const grid = weeklyGrid(planned)[0];
    const start = enrollmentStart(semester);

    return (
        <div className="flex flex-col gap-4">
            <Card size="sm" className="gap-2 px-3">
                <p className="flex items-center gap-2 text-sm font-semibold">
                    <CalendarPlus className="size-4 text-primary" aria-hidden="true" />
                    Planejar {semester}
                </p>
                <p className="text-sm text-muted-foreground">
                    {published
                        ? `A oferta de ${semester} já saiu. Escolha as turmas na Busca (as recomendações já ignoram o que você concluiu); elas aparecem aqui e na agenda do dia como prévia.`
                        : `A oferta de ${semester} ainda não foi publicada no SIGAA. Quando sair, monte a grade pela Busca.`}
                    {start &&
                        ` A matrícula começa em ${fullDate.format(new Date(`${start}T00:00:00Z`))}.`}
                </p>
                {published && (
                    <Link
                        to="/buscar"
                        search={{ semester }}
                        className={cn(buttonVariants({ size: 'sm' }), 'self-start')}
                    >
                        <Search aria-hidden="true" />
                        Escolher turmas de {semester}
                    </Link>
                )}
                <Link
                    to="/simulador"
                    search={{ semester }}
                    className="self-start text-xs font-semibold text-primary hover:underline"
                >
                    Montar e comparar outras grades no simulador
                </Link>
            </Card>
            {grid ? (
                <>
                    <WeeklyTable grid={grid} maxHours={maxHours} />
                    <PlannedClassList items={planned} onRemove={toggle} />
                </>
            ) : (
                <p className="rounded-2xl bg-card p-4 text-center text-sm text-muted-foreground">
                    Nenhuma turma de {semester} na sua grade ainda.
                </p>
            )}
        </div>
    );
}
