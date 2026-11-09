import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { MessageSquareText, Star } from 'lucide-react';
import { useState } from 'react';

import type { Review, ReviewSearch } from '#/queries/reviews';

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
import { Input } from '#/components/ui/input';
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
                    <ReviewsBrowser siape={siape} />
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
    return (
        <ul className="flex flex-col divide-y" aria-label="Avaliações">
            {reviews.map((review) => (
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
                        {review.semester && (
                            <span className="rounded-full bg-muted px-2 py-0.5">
                                Experiência: {review.semester}
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
                    {review.criteria && (
                        <p className="text-xs text-muted-foreground">
                            {[
                                ['Clareza', review.criteria.clarity],
                                ['Organização', review.criteria.organization],
                                ['Avaliação', review.criteria.assessment]
                            ]
                                .filter(([, value]) => value != null)
                                .map(([label, value]) => `${label}: ${value}/5`)
                                .join(' · ')}
                        </p>
                    )}
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

function ReviewsBrowser({ siape }: { siape: number }) {
    const [filters, setFilters] = useState<ReviewSearch>({ page: 1 });
    const query = useQuery(professorReviewsQueryOptions(siape, filters));
    const page = filters.page ?? 1;
    return (
        <div className="flex min-w-0 flex-col gap-4">
            <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                    event.preventDefault();
                    const fields = new FormData(event.currentTarget);
                    const subject = fields.get('subject');
                    const semester = fields.get('semester');
                    setFilters({
                        page: 1,
                        subject:
                            (typeof subject === 'string' ? subject.trim().toUpperCase() : '') ||
                            undefined,
                        semester:
                            (typeof semester === 'string' ? semester.trim() : '') || undefined,
                        order: filters.order
                    });
                }}
            >
                <label
                    htmlFor={`review-subject-filter-${siape}`}
                    className="flex min-w-0 flex-1 flex-col gap-1 text-sm"
                >
                    Matéria
                    <Input
                        name="subject"
                        id={`review-subject-filter-${siape}`}
                        placeholder="Código"
                        maxLength={16}
                        pattern="[A-Za-z0-9]{3,16}"
                    />
                </label>
                <label
                    htmlFor={`review-semester-filter-${siape}`}
                    className="flex min-w-0 flex-1 flex-col gap-1 text-sm"
                >
                    Semestre
                    <Input
                        name="semester"
                        id={`review-semester-filter-${siape}`}
                        placeholder="2026.2"
                        maxLength={6}
                        pattern="20[0-9]{2}\.[12]"
                    />
                </label>
                <Button variant="outline" type="submit">
                    Filtrar
                </Button>
            </form>
            <label className="flex items-center gap-2 text-sm">
                Ordenar
                <select
                    className="min-w-0 rounded-lg border bg-background p-2"
                    value={filters.order ?? 'recent'}
                    onChange={(event) =>
                        setFilters({
                            ...filters,
                            page: 1,
                            order:
                                event.target.value === 'best'
                                    ? 'best'
                                    : event.target.value === 'worst'
                                      ? 'worst'
                                      : 'recent'
                        })
                    }
                >
                    <option value="recent">Mais recentes</option>
                    <option value="best">Maior nota</option>
                    <option value="worst">Menor nota</option>
                </select>
            </label>
            {query.isPending ? (
                <LoadingText>Carregando avaliações...</LoadingText>
            ) : query.isError ? (
                <Button variant="outline" onClick={() => query.refetch()}>
                    Tentar carregar novamente
                </Button>
            ) : (
                <>
                    {query.data.reviews.length ? (
                        <ReviewList reviews={query.data.reviews} />
                    ) : (
                        <output className="text-sm text-muted-foreground">
                            Nenhuma avaliação corresponde aos filtros.
                        </output>
                    )}
                    <div className="flex items-center justify-between gap-2">
                        <Button
                            variant="outline"
                            disabled={page <= 1}
                            onClick={() => setFilters({ ...filters, page: page - 1 })}
                        >
                            Anterior
                        </Button>
                        <span className="text-xs text-muted-foreground">
                            {page} /{' '}
                            {Math.max(1, Math.ceil(query.data.total / query.data.page_size))}
                        </span>
                        <Button
                            variant="outline"
                            disabled={page * query.data.page_size >= query.data.total}
                            onClick={() => setFilters({ ...filters, page: page + 1 })}
                        >
                            Próxima
                        </Button>
                    </div>
                </>
            )}
        </div>
    );
}
