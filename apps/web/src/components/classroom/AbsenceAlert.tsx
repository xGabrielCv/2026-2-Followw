import { useQuery } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';

import type { ClassroomFrequency } from '#/queries/classrooms';

import { absenceRisk, withMarks } from '#/lib/lesson-marks';
import { cn } from '#/lib/shadcn';
import { classroomFrequencyQueryOptions, useLessonMarks } from '#/queries/classrooms';

const hoursLabel = (n: number) => `${n} hora${n === 1 ? '' : 's'}-aula`;

/** Aviso quando as faltas chegam perto do limite de 25% (presença mínima de 75% na UnB). */
export function AbsenceAlert({
    totals,
    compact = false,
    className
}: {
    totals: ClassroomFrequency['totals'];
    compact?: boolean;
    className?: string;
}) {
    const risk = absenceRisk(totals);
    if (!risk) return null;
    const danger = risk.level === 'danger';
    const title =
        risk.left < 0
            ? 'Passou do limite de faltas'
            : risk.left === 0
              ? 'No limite de faltas'
              : `Faltam ${hoursLabel(risk.left)} para o limite`;

    if (compact) {
        const short =
            risk.left < 0
                ? 'Acima do limite de faltas'
                : risk.left === 0
                  ? 'No limite de faltas'
                  : `Restam ${risk.left}h de falta`;
        return (
            <span
                className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                    danger ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning',
                    className
                )}
            >
                <TriangleAlert className="size-3" aria-hidden />
                {short}
            </span>
        );
    }

    return (
        <div
            role="alert"
            className={cn(
                'flex gap-3 rounded-xl p-3 text-sm',
                danger ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning',
                className
            )}
        >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div>
                <p className="font-semibold">{title}</p>
                <p className="text-foreground/80">
                    {risk.absences} de {risk.max} faltas permitidas. A UnB reprova por falta com
                    menos de <strong>75% de presença</strong>
                    {risk.left < 0 ? '.' : ': cuide das próximas aulas.'}
                    {totals?.estimated ? ' Conta também as aulas que você marcou.' : ''}
                </p>
            </div>
        </div>
    );
}

/** O aviso na lista de turmas, só com a frequência que já está salva (não vai ao SIGAA). */
export function CachedAbsenceBadge({ id }: { id: string }) {
    const { data } = useQuery({ ...classroomFrequencyQueryOptions(id), enabled: false });
    const { marks } = useLessonMarks(id);
    if (!data) return null;
    return <AbsenceAlert compact totals={withMarks(data, marks).totals} className="shrink-0" />;
}
