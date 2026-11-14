import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

import type { components } from '#/queries/schema.gen';

import { newKey } from '#/lib/author';
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

const normalizeSubject = (subject?: string | null) => {
    const clean = subject?.trim().toUpperCase();
    return clean || null;
};

const compositeReviewKey = (siape: number, subject: string) => `${siape}:${subject}`;

/** Descobre a chave salva em `ownReviews` para `(siape, subject?)`, preservando a chave legada `[siape]`. */
export function findOwnReviewKey<T extends { subject?: string | null }>(
    reviews: Record<string, T>,
    siape: number,
    subject?: string | null
): string | null {
    const norm = normalizeSubject(subject);
    const legacyKey = String(siape);
    const legacy = reviews[legacyKey];
    if (norm) {
        const compKey = compositeReviewKey(siape, norm);
        if (reviews[compKey]) return compKey;
        const legacySubject = normalizeSubject(legacy?.subject);
        if (legacy && (!legacySubject || legacySubject === norm)) return legacyKey;
        return null;
    }
    if (legacy) return legacyKey;
    const prefix = `${siape}:`;
    return Object.keys(reviews).find((key) => key.startsWith(prefix)) ?? null;
}

export function findOwnReview<T extends { subject?: string | null }>(
    reviews: Record<string, T>,
    siape: number,
    subject?: string | null
): T | undefined {
    const key = findOwnReviewKey(reviews, siape, subject);
    return key ? reviews[key] : undefined;
}

function targetSaveKey(
    reviews: Record<string, OwnReview>,
    siape: number,
    subject?: string | null
): string {
    const norm = normalizeSubject(subject);
    if (!norm) return String(siape);
    const compKey = compositeReviewKey(siape, norm);
    if (reviews[compKey]) return compKey;
    const legacyKey = String(siape);
    const legacy = reviews[legacyKey];
    const legacySubject = normalizeSubject(legacy?.subject);
    // Primeira avaliação (ou mesma matéria já salva na chave numérica) continua em `[siape]`.
    if (!legacy || !legacySubject || legacySubject === norm) return legacyKey;
    return compKey;
}

export function useOwnReview(siape: number, subject?: string | null): OwnReview | undefined {
    const reviews = useSyncExternalStore(
        ownReviews.subscribe,
        ownReviews.getSnapshot,
        ownReviews.getServerSnapshot
    );
    return findOwnReview(reviews, siape, subject);
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
    const key = targetSaveKey(store.getSnapshot(), siape, body.subject);
    const own = findOwnReview(store.getSnapshot(), siape, body.subject);
    if (own) {
        try {
            await apiClient.PUT('/reviews/{review_id}', {
                params: { path: { review_id: own.id }, header: { 'X-Review-Token': own.token } },
                body
            });
            store.set({ ...store.getSnapshot(), [key]: { ...own, ...body } });
            await flushLocalStorage();
            return;
        } catch (error) {
            if (!(error instanceof ApiError && error.isNotFound)) throw error;
        }
    }
    const credential = newKey();
    const payload = { ...body, siape, credential };
    const { data } = await apiClient.POST('/reviews', { body: payload });
    if (!data) throw new Error('Não foi possível salvar a avaliação');
    store.set({
        ...store.getSnapshot(),
        [key]: { ...body, id: data.review.id, token: credential }
    });
    await flushLocalStorage();
}

export type DeleteReviewInput = number | { siape: number; subject?: string | null };

export async function deleteReview(input: DeleteReviewInput) {
    const siape = typeof input === 'number' ? input : input.siape;
    const subject = typeof input === 'number' ? undefined : input.subject;
    const store = ownReviews.atAccount(localAccount());
    const key = findOwnReviewKey(store.getSnapshot(), siape, subject);
    const own = key ? store.getSnapshot()[key] : undefined;
    if (!own || !key) return;
    try {
        await apiClient.DELETE('/reviews/{review_id}', {
            params: { path: { review_id: own.id }, header: { 'X-Review-Token': own.token } }
        });
    } catch (error) {
        if (!(error instanceof ApiError && error.isNotFound)) throw error;
    }
    if (store.getSnapshot()[key]?.id !== own.id) return;
    const { [key]: _, ...rest } = store.getSnapshot();
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
