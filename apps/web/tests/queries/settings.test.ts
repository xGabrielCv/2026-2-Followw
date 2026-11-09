import type { Middleware } from 'openapi-fetch';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { apiClient } from '#/queries/client';
import { entriesStore } from '#/queries/events';
import { settingsStore, syncStatisticsSharing } from '#/queries/settings';

import { useDom } from '../helpers/dom';

useDom();

describe('configurações e lançamentos ficam no navegador', () => {
    let middleware: Middleware;
    let requests: Request[];

    beforeEach(() => {
        requests = [];
        middleware = {
            onRequest: ({ request }) => {
                requests.push(request);
                return Response.json({ shared: true, classrooms: 2 });
            }
        };
        apiClient.use(middleware);
    });

    afterEach(() => {
        apiClient.eject(middleware);
        settingsStore('251000000').clear();
        settingsStore('252000000').clear();
        entriesStore('251000000').clear();
    });

    test('cada matrícula tem as suas, guardadas no localStorage e não na API', () => {
        settingsStore('251000000').set({ displayName: 'Ana', subjectColors: { FGA0030: 2 } });
        settingsStore('252000000').set({ displayName: 'Bia' });

        expect(settingsStore('251000000').getSnapshot().displayName).toBe('Ana');
        expect(settingsStore('252000000').getSnapshot().displayName).toBe('Bia');
        expect(localStorage.getItem('followw:settings:251000000')).toBeNull();
        expect(requests).toHaveLength(0);
    });

    test('lançamentos do calendário também ficam só no navegador', () => {
        entriesStore('251000000').set([
            {
                id: '1',
                date: '2026-11-20',
                time: '10:00',
                title: 'Prova 2',
                kind: 'prova',
                subject_code: 'FGA0030',
                notes: null,
                remind_days: 1
            }
        ]);
        expect(entriesStore('251000000').getSnapshot()[0]?.title).toBe('Prova 2');
        expect(localStorage.getItem('followw:events:251000000')).toBeNull();
        expect(requests).toHaveLength(0);
    });

    test('só o compartilhamento dos índices vai à API, sem dado pessoal no corpo', async () => {
        await syncStatisticsSharing(true);
        expect(requests).toHaveLength(1);
        expect(new URL(requests[0].url).pathname).toBe('/api/me/statistics-sharing');
        expect(requests[0].method).toBe('PUT');
        // nada além do pedido e das chaves de liberações anteriores (aqui, nenhuma)
        expect(await requests[0].json()).toEqual({ shared: true, keys: {} });
    });
});
