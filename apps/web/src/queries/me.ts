import { type QueryClient, queryOptions } from '@tanstack/react-query';

import type { components } from '#/queries/schema.gen';

import { api } from '#/queries/api.ts';
import { ApiError } from '#/queries/errors.ts';
import { ssrRequest } from '#/queries/ssr';

export type UserProfile = components['schemas']['UserProfile'];

const { queryKey, queryFn } = api.queryOptions('get', '/me');

export async function seedAnonymousProfile(client: QueryClient) {
    const ssr = await ssrRequest();
    if (ssr && !ssr.getCookie('refresh_token')) client.setQueryData(queryKey, null);
}

export const meQueryOptions = queryOptions({
    queryKey,
    queryFn: async (context) => {
        const ssr = await ssrRequest();
        if (ssr && !ssr.getCookie('refresh_token')) return null;
        try {
            return (await queryFn(context)) ?? null;
        } catch (error) {
            if (error instanceof ApiError && error.isUnauthorized) return null;
            throw error;
        }
    }
});
