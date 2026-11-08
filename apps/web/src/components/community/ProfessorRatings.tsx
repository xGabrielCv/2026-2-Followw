import { Link } from '@tanstack/react-router';

import type { RatingSummary } from '#/queries/reviews';

import { attendanceSentence } from '#/components/community/AttendanceSummary';
import { RatingBadge } from '#/components/community/RatingBadge';
import { titleCase } from '#/lib/profile';

/** Nota e chamada de cada docente da turma, com o link para as avaliações completas. */
export function ProfessorRatings({
    professors,
    ratings
}: {
    professors: { siape?: number | null; name: string }[];
    ratings: Record<string, RatingSummary>;
}) {
    return (
        <ul className="flex flex-col gap-1.5">
            {professors.map(({ siape, name }) => {
                if (siape == null) return null;
                const rating = ratings[siape];
                const attendance = rating && attendanceSentence(rating.attendance);
                return (
                    <li key={siape} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <Link
                            to="/professores/$siape"
                            params={{ siape }}
                            className="min-w-0 hover:text-primary hover:underline"
                        >
                            {titleCase(name)}
                        </Link>
                        {rating ? (
                            <>
                                <RatingBadge rating={rating} />
                                {attendance && (
                                    <span className="text-xs font-normal text-muted-foreground">
                                        {attendance}
                                    </span>
                                )}
                            </>
                        ) : (
                            <span className="text-xs font-normal text-muted-foreground">
                                Sem avaliações ainda
                            </span>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
