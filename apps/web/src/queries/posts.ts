import { queryOptions } from '@tanstack/react-query';

import type { components } from '#/queries/schema.gen';

import {
    type ClassroomPost,
    classroomPostsQueryOptions,
    classroomsQueryOptions
} from '#/queries/classrooms';
import { ApiError } from '#/queries/errors';

export type ClassroomNews = components['schemas']['ClassroomNews'];

const LATEST = 5;

const published = (news: ClassroomNews) =>
    news.post.published_at ?? `${news.post.published_on ?? '0000-00-00'}T00:00:00`;

/**
 * As notícias mais recentes das turmas atuais, montadas no aparelho a partir das postagens de cada
 * turma (que o carregamento em segundo plano já deixa salvas): nenhuma ida extra ao SIGAA.
 */
export const latestNewsQueryOptions = queryOptions({
    queryKey: ['latest-news'],
    queryFn: async ({ client, signal }) => {
        const classrooms = await client.query(classroomsQueryOptions);
        const items: ClassroomNews[] = [];
        let partial = false;
        // em sequência: a sessão do SIGAA do aluno atende uma turma por vez
        await classrooms.reduce<Promise<void>>(
            (previous, classroom) =>
                previous.then(async () => {
                    signal.throwIfAborted();
                    const options = classroomPostsQueryOptions(classroom.id);
                    const posts = await client.query(options).catch((error: unknown) => {
                        signal.throwIfAborted();
                        if (error instanceof ApiError && error.isUnauthorized) throw error;
                        const cached = client.getQueryData<ClassroomPost[]>(options.queryKey);
                        if (!cached) throw error;
                        partial = true;
                        return cached;
                    });
                    signal.throwIfAborted();
                    for (const post of posts)
                        if (post.type === 'news') items.push({ classroom, post });
                    return undefined;
                }),
            Promise.resolve()
        );
        return {
            partial,
            items: items
                .toSorted((a, b) => published(b).localeCompare(published(a)))
                .slice(0, LATEST)
        };
    },
    staleTime: 10 * 60_000
});
