import type { Middleware } from 'openapi-fetch';

import { QueryClient } from '@tanstack/react-query';
import { afterEach, expect, test } from 'bun:test';

import { classroomPostsQueryOptions } from '#/queries/classrooms';
import { apiClient } from '#/queries/client';
import { latestNewsQueryOptions } from '#/queries/posts';

let middleware: Middleware;
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
afterEach(() => {
    if (middleware) apiClient.eject(middleware);
    client.clear();
});

test('falha da origem preserva notícia salva com aviso de atualização parcial', async () => {
    let fail = false;
    middleware = {
        onRequest: ({ request }) =>
            new URL(request.url).pathname.endsWith('/posts')
                ? fail
                    ? Response.json({ detail: 'Indisponível' }, { status: 502 })
                    : Response.json([
                          {
                              id: 'news:one',
                              type: 'news',
                              title: 'Notícia sintética',
                              published_on: '2026-11-09'
                          }
                      ])
                : Response.json([{ id: 'one' }])
    };
    apiClient.use(middleware);
    const first = await client.query(latestNewsQueryOptions);
    expect(first.items).toHaveLength(1);
    await client.invalidateQueries({ queryKey: classroomPostsQueryOptions('one').queryKey });
    fail = true;
    const next = await client.query({ ...latestNewsQueryOptions, staleTime: 0 });
    expect(next.items).toEqual(first.items);
    expect(next.partial).toBe(true);
});

test('falha sem cópia salva não vira notícia vazia atualizada', async () => {
    middleware = {
        onRequest: ({ request }) =>
            new URL(request.url).pathname.endsWith('/posts')
                ? Response.json({ detail: 'Indisponível' }, { status: 502 })
                : Response.json([{ id: 'one' }])
    };
    apiClient.use(middleware);
    let failed = false;
    try {
        await client.query(latestNewsQueryOptions);
    } catch {
        failed = true;
    }
    expect(failed).toBe(true);
});
