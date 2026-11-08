import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';

import type { ProfessorItem } from '#/queries/professors';

import { RatingBadge } from '#/components/community/RatingBadge';
import { PersonPhoto } from '#/components/ui/person-photo';
import { titleCase, unitLabel } from '#/lib/profile';

export function ProfessorCard({
    professor,
    rank
}: {
    professor: ProfessorItem;
    // posição no ranking de avaliações
    rank?: number;
}) {
    const label = unitLabel(professor.unit);

    return (
        <Link
            to="/professores/$siape"
            params={{ siape: professor.siape }}
            className="group flex items-center justify-between gap-3 rounded-2xl bg-card p-3 shadow-card ring-1 ring-foreground/8 transition-colors hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            aria-label={`Ver perfil de ${titleCase(professor.name)}`}
        >
            <div className="flex min-w-0 items-center gap-3">
                {rank != null && (
                    <span className="w-6 shrink-0 text-center text-sm font-bold text-muted-foreground tabular-nums">
                        {rank}º
                    </span>
                )}
                <PersonPhoto src={professor.photo} size="sm" />
                <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-heading text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
                        {titleCase(professor.name)}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{label}</span>
                </div>
            </div>
            {professor.rating ? (
                <RatingBadge rating={professor.rating} className="ml-auto" />
            ) : (
                rank != null && (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">Sem nota</span>
                )
            )}
            <ChevronRight
                className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                aria-hidden="true"
            />
        </Link>
    );
}
