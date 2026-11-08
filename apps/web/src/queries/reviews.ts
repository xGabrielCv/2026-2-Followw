import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

import type { components } from '#/queries/schema.gen';

import { STORAGE_KEYS, storedValue } from '#/lib/local-storage';
import { api } from '#/queries/api';
import { apiClient } from '#/queries/client';

export type Rating = components['schemas']['Rating'];
export type RatingSummary = components['schemas']['RatingSummary'];
export type Review = components['schemas']['Review'];
export type ReviewInput = components['schemas']['ReviewInput'];
export type Attendance = NonNullable<ReviewInput['attendance']>;
export type ProfessorOrder = 'name' | 'best' | 'worst' | 'reviews';

/** A avaliação que este navegador fez: o segredo deixa editar ou apagar, sem identificar ninguém. */
export interface OwnReview extends ReviewInput {
    id: string;
    token: string;
}

const NO_REVIEWS: Record<string, OwnReview> = {};
export const ownReviews = storedValue(STORAGE_KEYS.REVIEWS, NO_REVIEWS);

export function useOwnReview(siape: number): OwnReview | undefined {
    const reviews = useSyncExternalStore(
        ownReviews.subscribe,
        ownReviews.getSnapshot,
        ownReviews.getServerSnapshot
    );
    return reviews[siape];
}

// avaliações mudam pouco; voltar ao perfil não precisa refazer a consulta na hora
const STALE_TIME = 5 * 60_000;

export const professorReviewsQueryOptions = (siape: number) =>
    api.queryOptions(
        'get',
        '/public/professors/{siape}/reviews',
        { params: { path: { siape } } },
        { staleTime: STALE_TIME }
    );

export const professorRatingsQueryOptions = (siapes: number[]) =>
    api.queryOptions(
        'get',
        '/public/professors/ratings',
        { params: { query: { siape: siapes.toSorted((a, b) => a - b) } } },
        { staleTime: STALE_TIME, enabled: siapes.length > 0 }
    );

export interface RankingSearch {
    q?: string;
    subject?: string;
    order: ProfessorOrder;
    rated?: boolean;
    page?: number;
}

export const professorRankingQueryOptions = (search: RankingSearch) =>
    api.queryOptions('get', '/public/professors', { params: { query: search } });

type SaveReview = { siape: number; body: ReviewInput };

/** Cria a avaliação ou, se este navegador já avaliou o docente, edita a mesma. */
export function useSaveReview() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ siape, body }: SaveReview) => {
            const own = ownReviews.getSnapshot()[siape];
            if (own) {
                const { error } = await apiClient.PUT('/reviews/{review_id}', {
                    params: {
                        path: { review_id: own.id },
                        header: { 'X-Review-Token': own.token }
                    },
                    body
                });
                if (!error) {
                    ownReviews.set({ ...ownReviews.getSnapshot(), [siape]: { ...own, ...body } });
                    return;
                }
                // apagada em outro lugar: vira uma avaliação nova
            }
            const { data, error } = await apiClient.POST('/reviews', {
                body: { ...body, siape }
            });
            if (error || !data) throw new Error('Não foi possível salvar a avaliação');
            ownReviews.set({
                ...ownReviews.getSnapshot(),
                [siape]: { ...body, id: data.review.id, token: data.token }
            });
        },
        onSettled: () => invalidateReviews(queryClient)
    });
}

export function useDeleteReview() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (siape: number) => {
            const own = ownReviews.getSnapshot()[siape];
            if (!own) return;
            const { error, response } = await apiClient.DELETE('/reviews/{review_id}', {
                params: { path: { review_id: own.id }, header: { 'X-Review-Token': own.token } }
            });
            if (error && response.status !== 404)
                throw new Error('Não foi possível apagar a avaliação');
            const { [siape]: _, ...rest } = ownReviews.getSnapshot();
            ownReviews.set(rest);
        },
        onSettled: () => invalidateReviews(queryClient)
    });
}

function invalidateReviews(queryClient: ReturnType<typeof useQueryClient>) {
    return Promise.all(
        [
            '/public/professors/{siape}/reviews',
            '/public/professors/ratings',
            '/public/professors'
        ].map((path) => queryClient.invalidateQueries({ queryKey: ['get', path] }))
    );
}
