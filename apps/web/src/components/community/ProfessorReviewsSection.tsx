import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { MessageSquareText, Star } from 'lucide-react';
import { useState } from 'react';

import type { Review } from '#/queries/reviews';

import { AttendanceSummary } from '#/components/community/AttendanceSummary';
import { ReportButton } from '#/components/community/ReportButton';
import { ReviewDialog } from '#/components/community/ReviewDialog';
import { LoadingText } from '#/components/LoadingText';
import { Button } from '#/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '#/components/ui/dialog';
import { titleCase } from '#/lib/profile';
import {
    ATTENDANCE_LABELS,
    formatRating,
    ratingLabel,
    ratingTone,
    reviewMonth
} from '#/lib/reviews';
import { cn } from '#/lib/shadcn';
import { meQueryOptions } from '#/queries/me';
import { professorReviewsQueryOptions } from '#/queries/reviews';

/** A nota média do docente e a chamada; as avaliações completas abrem num pop-up. */
export function ProfessorReviewsSection({ siape, name }: { siape: number; name: string }) {
    const { data: user } = useSuspenseQuery(meQueryOptions);
    const reviews = useQuery(professorReviewsQueryOptions(siape));
    const [reviewing, setReviewing] = useState(false);
    const [reading, setReading] = useState(false);
    const summary = reviews.data?.summary;
    const all = reviews.data?.reviews ?? [];

    return (
        <section aria-label="Avaliações dos alunos" className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 px-1">
                <h2 className="text-base font-semibold">Avaliações dos alunos</h2>
                {user ? (
                    <Button size="sm" onClick={() => setReviewing(true)}>
                        <Star aria-hidden="true" />
                        Avaliar
                    </Button>
                ) : (
                    <Link to="/login" className="text-xs font-semibold text-primary">
                        Entre para avaliar
                    </Link>
                )}
            </div>
            <div className="flex flex-col gap-3 rounded-2xl bg-card p-4 shadow-card ring-1 ring-foreground/8">
                {reviews.isPending ? (
                    <LoadingText>Carregando avaliações...</LoadingText>
                ) : reviews.isError ? (
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-sm text-muted-foreground">
                            Não foi possível carregar as avaliações.
                        </p>
                        <Button variant="outline" size="sm" onClick={() => reviews.refetch()}>
                            Tentar de novo
                        </Button>
                    </div>
                ) : !summary ? (
                    <p className="text-sm text-muted-foreground">
                        Ninguém avaliou este docente ainda. As avaliações são anônimas.
                    </p>
                ) : (
                    <>
                        <div className="flex items-center gap-4">
                            <div className="flex flex-col items-center">
                                <span
                                    className={cn(
                                        'text-4xl leading-none font-bold tabular-nums',
                                        ratingTone(summary.average)
                                    )}
                                >
                                    {formatRating(summary.average)}
                                </span>
                                <span className="text-xs text-muted-foreground">de 100</span>
                            </div>
                            <div className="flex min-w-0 flex-col gap-1 text-sm">
                                <span className="font-medium first-letter:uppercase">
                                    Nota média {ratingLabel(summary.average)}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                    {summary.count}{' '}
                                    {summary.count === 1
                                        ? 'avaliação anônima'
                                        : 'avaliações anônimas'}
                                </span>
                            </div>
                        </div>
                        <AttendanceSummary attendance={summary.attendance} />
                        <Button variant="outline" onClick={() => setReading(true)}>
                            <MessageSquareText aria-hidden="true" />
                            Ver avaliações completas
                        </Button>
                    </>
                )}
            </div>
            <Dialog open={reading} onOpenChange={setReading}>
                <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Avaliações de {titleCase(name)}</DialogTitle>
                        <DialogDescription>Anônimas: nenhuma traz quem avaliou.</DialogDescription>
                    </DialogHeader>
                    <ReviewList reviews={all} />
                </DialogContent>
            </Dialog>
            {user && (
                <ReviewDialog
                    professors={[{ siape, name }]}
                    open={reviewing}
                    onOpenChange={setReviewing}
                />
            )}
        </section>
    );
}

/** Cada avaliação com a nota, a matéria, a chamada e o texto, quando houver. */
export function ReviewList({ reviews }: { reviews: Review[] }) {
    // as com comentário primeiro: são as que mais ajudam
    const sorted = reviews.toSorted(
        (a, b) => Number(Boolean(b.comment)) - Number(Boolean(a.comment))
    );
    return (
        <ul className="flex flex-col divide-y" aria-label="Avaliações">
            {sorted.map((review) => (
                <li key={review.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span
                            className={cn(
                                'rounded-full bg-muted px-2 py-0.5 font-semibold tabular-nums',
                                ratingTone(review.rating)
                            )}
                        >
                            Nota {review.rating}
                        </span>
                        {review.subject && (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                                {review.subject.code}
                            </span>
                        )}
                        {review.attendance && (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                                Chamada: {ATTENDANCE_LABELS[review.attendance]}
                            </span>
                        )}
                        <span className="ml-auto text-muted-foreground">
                            {reviewMonth(review.month)}
                        </span>
                        <ReportButton target="review" id={review.id} what="esta avaliação" />
                    </div>
                    {review.comment ? (
                        <p className="text-sm wrap-anywhere whitespace-pre-line">
                            {review.comment}
                        </p>
                    ) : (
                        <p className="text-xs text-muted-foreground italic">Sem comentário.</p>
                    )}
                </li>
            ))}
        </ul>
    );
}
