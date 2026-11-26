import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { localStorageRepository, STORAGE_KEYS } from '#/lib/local-storage';
import {
    credentialsQueryOptions,
    hasValidCard,
    type RestaurantCredentials
} from '#/queries/restaurant-account';

// Sem `credentials`, marca que o SIGAA devolveu uma carteirinha vencida.
interface SavedCard {
    registration: string;
    credentials?: RestaurantCredentials;
    updatedAt: number;
}

function isCredentials(value: unknown): value is RestaurantCredentials {
    return (
        value !== null &&
        typeof value === 'object' &&
        'token' in value &&
        typeof value.token === 'string' &&
        value.token.length > 0 &&
        'valid_until' in value &&
        typeof value.valid_until === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(value.valid_until)
    );
}

function readSavedCard(registration: string): SavedCard | undefined {
    const saved = localStorageRepository.get<SavedCard>(STORAGE_KEYS.STUDENT_CARD);
    if (
        !saved ||
        saved.registration !== registration ||
        !Number.isFinite(saved.updatedAt) ||
        saved.updatedAt <= 0
    ) {
        return undefined;
    }
    if (saved.credentials === undefined) {
        return { registration, updatedAt: saved.updatedAt };
    }
    return isCredentials(saved.credentials) && hasValidCard(saved.credentials) ? saved : undefined;
}

/** Mantém a carteirinha do RU cifrada no cofre local para abertura offline. */
export function useStudentCard(registration: string) {
    const queryClient = useQueryClient();
    const options = credentialsQueryOptions(registration);
    const saved = readSavedCard(registration);

    const query = useQuery({
        ...options,
        initialData: saved?.credentials,
        initialDataUpdatedAt: saved?.credentials ? saved.updatedAt : undefined
    });

    const { data, dataUpdatedAt } = query;

    useEffect(() => {
        const stored = readSavedCard(registration);
        if (stored?.credentials && (!data || stored.updatedAt > dataUpdatedAt)) {
            queryClient.setQueryData(options.queryKey, stored.credentials, {
                updatedAt: stored.updatedAt
            });
            return;
        }
        if (!data || dataUpdatedAt <= 0) return;
        if (hasValidCard(data)) {
            if (!stored || dataUpdatedAt >= stored.updatedAt) {
                localStorageRepository.set(STORAGE_KEYS.STUDENT_CARD, {
                    registration,
                    credentials: data,
                    updatedAt: dataUpdatedAt
                } satisfies SavedCard);
            }
            return;
        }
        if (!stored || stored.credentials || dataUpdatedAt > stored.updatedAt) {
            localStorageRepository.set(STORAGE_KEYS.STUDENT_CARD, {
                registration,
                updatedAt: dataUpdatedAt
            } satisfies SavedCard);
        }
    }, [data, dataUpdatedAt, options.queryKey, queryClient, registration]);

    return query;
}
