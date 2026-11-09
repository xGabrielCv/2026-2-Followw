import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

import type { components } from '#/queries/schema.gen';

import { flushLocalStorage, localAccount, STORAGE_KEYS, storedValue } from '#/lib/local-storage';
import { api } from '#/queries/api';
import { apiClient } from '#/queries/client';
import { ApiError } from '#/queries/errors';

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

export interface ReviewSearch {
    semester?: string;
    subject?: string;
    page?: number;
    order?: 'recent' | 'best' | 'worst';
}

export const professorReviewsQueryOptions = (siape: number, filters?: ReviewSearch) =>
    api.queryOptions(
        'get',
        '/public/professors/{siape}/reviews',
        { params: { path: { siape }, ...(filters ? { query: filters } : {}) } },
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

export async function saveReview({ siape, body }: SaveReview) {
    const store = ownReviews.atAccount(localAccount());
    const own = store.getSnapshot()[siape];
    if (own) {
        try {
            await apiClient.PUT('/reviews/{review_id}', {
                params: { path: { review_id: own.id }, header: { 'X-Review-Token': own.token } },
                body
            });
            store.set({ ...store.getSnapshot(), [siape]: { ...own, ...body } });
            await flushLocalStorage();
            return;
        } catch (error) {
            if (!(error instanceof ApiError && error.isNotFound)) throw error;
        }
    }
    const { data } = await apiClient.POST('/reviews', { body: { ...body, siape } });
    if (!data) throw new Error('Não foi possível salvar a avaliação');
    store.set({
        ...store.getSnapshot(),
        [siape]: { ...body, id: data.review.id, token: data.token }
    });
    await flushLocalStorage();
}

export async function deleteReview(siape: number) {
    const store = ownReviews.atAccount(localAccount());
    const own = store.getSnapshot()[siape];
    if (!own) return;
    try {
        await apiClient.DELETE('/reviews/{review_id}', {
            params: { path: { review_id: own.id }, header: { 'X-Review-Token': own.token } }
        });
    } catch (error) {
        if (!(error instanceof ApiError && error.isNotFound)) throw error;
    }
    if (store.getSnapshot()[siape]?.id !== own.id) return;
    const { [siape]: _, ...rest } = store.getSnapshot();
    store.set(rest);
    await flushLocalStorage();
}

/** Cria a avaliação ou, se este navegador já avaliou o docente, edita a mesma. */
export function useSaveReview() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: saveReview,
        onSettled: () => invalidateReviews(queryClient)
    });
}

export function useDeleteReview() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: deleteReview,
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
