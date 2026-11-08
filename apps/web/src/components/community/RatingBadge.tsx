import { useQuery } from '@tanstack/react-query';
import { Star } from 'lucide-react';

import type { Rating, RatingSummary } from '#/queries/reviews';

import { formatRating, ratingTone } from '#/lib/reviews';
import { cn } from '#/lib/shadcn';
import { professorRatingsQueryOptions } from '#/queries/reviews';

const avaliacoes = (count: number) => `${count} ${count === 1 ? 'avaliação' : 'avaliações'}`;

/** A nota média do docente (0 a 100) ao lado do nome; sem avaliação, não aparece. */
export function RatingBadge({
    rating,
    showCount = false,
    className
}: {
    rating: Rating | null | undefined;
    showCount?: boolean;
    className?: string;
}) {
    if (!rating) return null;
    return (
        <span
            className={cn(
                'inline-flex shrink-0 items-center gap-0.5 rounded-full bg-muted px-1.5 py-px align-middle text-xs font-semibold whitespace-nowrap tabular-nums',
                ratingTone(rating.average),
                className
            )}
            title={`Nota ${formatRating(rating.average)} de 100 em ${avaliacoes(rating.count)}`}
        >
            <Star className="size-3 fill-current" aria-hidden="true" />
            Nota {formatRating(rating.average)}
            {showCount && (
                <span className="font-normal text-muted-foreground">
                    {' '}
                    · {avaliacoes(rating.count)}
                </span>
            )}
        </span>
    );
}

const NO_RATINGS: Record<string, RatingSummary> = {};

/** As notas de vários docentes numa consulta só, pelo SIAPE. */
export function useProfessorRatings(siapes: (number | null | undefined)[]) {
    const wanted = [...new Set(siapes.filter((siape): siape is number => siape != null))];
    const { data } = useQuery(professorRatingsQueryOptions(wanted));
    return data ?? NO_RATINGS;
}
