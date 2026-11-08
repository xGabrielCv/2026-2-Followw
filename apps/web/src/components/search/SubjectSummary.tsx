import type { CatalogSubject } from '#/queries/subjects';

import { SubjectKindBadge } from '#/components/search/SubjectKindBadge';
import { Badge } from '#/components/ui/badge';

export function SubjectSummary({
    subject,
    currentPeriod = null,
    done = false
}: {
    subject: CatalogSubject;
    currentPeriod?: number | null;
    done?: boolean;
}) {
    // A API só envia período positivo.
    const period = subject.curriculum_period || null;
    const ahead = period != null && currentPeriod != null ? period > currentPeriod : null;
    // de qual oferta são as turmas listadas: deixa claro se é a do atual ou a do próximo
    const offer = subject.classrooms?.[0]?.semester;
    return (
        <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs font-semibold text-primary">{subject.code}</span>
            <span className="text-sm leading-snug font-semibold">{subject.name}</span>
            {(subject.kind || period != null || offer) && (
                <span className="-ml-0.5 flex flex-wrap items-center gap-2">
                    <SubjectKindBadge kind={subject.kind} />
                    {period != null && (
                        <Badge
                            variant={
                                done || ahead == null
                                    ? 'outline'
                                    : ahead
                                      ? 'default'
                                      : 'destructive'
                            }
                            className={
                                done
                                    ? 'border-transparent bg-blue-500/10 text-blue-500'
                                    : ahead
                                      ? 'bg-primary/10 text-primary'
                                      : undefined
                            }
                        >
                            {period}º semestre
                        </Badge>
                    )}
                    {offer && (
                        <Badge
                            className="bg-primary/10 text-primary tabular-nums"
                            title={`Turmas da oferta de ${offer}`}
                        >
                            {offer}
                        </Badge>
                    )}
                </span>
            )}
        </span>
    );
}
