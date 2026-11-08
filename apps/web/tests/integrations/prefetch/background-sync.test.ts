import type { Middleware } from 'openapi-fetch';

import { QueryClient } from '@tanstack/react-query';
import { describe, expect, test } from 'bun:test';

import { runBackgroundSync } from '#/integrations/prefetch/background-sync';
import { apiClient } from '#/queries/client';

const turma = (id: string, current: boolean, semester = '2026.2') => ({
    id,
    number: '01',
    semester,
    current,
    professors: [],
    subject: { code: id, name: id }
});

function respond(url: URL) {
    if (url.pathname.endsWith('/classrooms'))
        return Response.json(
            url.search.includes('all')
                ? [turma('T1', true), turma('OLD', false, '2025.2')]
                : [turma('T1', true)]
        );
    if (url.pathname.endsWith('/news')) return Response.json({ items: [] });
    return Response.json([]);
}

describe('carregamento em segundo plano', () => {
    test('busca na ordem de urgência, um passo por vez, e pula o que está fresco', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const order: string[] = [];
        let active = 0;
        let maxActive = 0;
        const middleware: Middleware = {
            async onRequest({ request }) {
                active++;
                maxActive = Math.max(maxActive, active);
                const url = new URL(request.url);
                order.push(url.pathname.replace('/api', '') + url.search);
                await Bun.sleep(2);
                active--;
                return respond(url);
            }
        };
        apiClient.use(middleware);
        try {
            const log = await runBackgroundSync(client, new AbortController().signal, {
                internships: false
            });
            expect(order).toEqual([
                '/classrooms',
                '/classrooms?semester=all',
                '/classrooms/T1/frequency',
                // as notícias saem das postagens já salvas: nada de /posts/news
                '/classrooms/T1/posts',
                '/classrooms/T1/members',
                '/classrooms/OLD/statistics'
            ]);
            expect(maxActive).toBe(1);
            expect(log.every((step) => step.ok)).toBe(true);

            order.length = 0;
            const again = await runBackgroundSync(client, new AbortController().signal, {
                internships: false
            });
            // tudo fresco no cache: nada vai à rede
            expect(order).toEqual([]);
            expect(again.every((step) => step.cached)).toBe(true);
        } finally {
            apiClient.eject(middleware);
            client.clear();
        }
    });

    test('para quando o app fecha', async () => {
        const controller = new AbortController();
        controller.abort();
        expect(await runBackgroundSync(new QueryClient(), controller.signal)).toEqual([]);
    });
});
