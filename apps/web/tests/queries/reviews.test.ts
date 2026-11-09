import type { Middleware } from 'openapi-fetch';

import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';

import { localStorageRepository, selectLocalAccount } from '#/lib/local-storage';
import { apiClient } from '#/queries/client';
import { ApiError } from '#/queries/errors';
import { deleteReview, ownReviews, saveReview } from '#/queries/reviews';

import { useDom } from '../helpers/dom';

useDom();
let middleware: Middleware;
let network: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
let respond: (request: Request) => Response;
let requests: Request[];
const own = { rating: 60, id: '11111111-1111-4111-8111-111111111111', token: 'a'.repeat(64) };

beforeEach(() => {
    network = spyOn(globalThis, 'fetch').mockImplementation(
        Object.assign(
            async () => Response.json({ token: 'autorizacao-sintetica', expires_in: 120 }),
            { preconnect: globalThis.fetch.preconnect }
        )
    );
    selectLocalAccount('251000001');
    requests = [];
    respond = () => Response.json({ review: { id: own.id }, token: own.token });
    middleware = {
        onRequest: ({ request }) => {
            requests.push(request);
            return respond(request);
        }
    };
    apiClient.use(middleware);
});
afterEach(() => {
    network.mockRestore();
    apiClient.eject(middleware);
    localStorageRepository.clear();
    selectLocalAccount();
});

test('avaliação criada depois da troca de conta guarda a chave somente na conta original', async () => {
    respond = () => {
        selectLocalAccount('252000002');
        return Response.json({ review: { id: own.id }, token: own.token });
    };
    await saveReview({ siape: 111, body: { rating: 60 } });
    expect(ownReviews.getSnapshot()[111]).toBeUndefined();
    selectLocalAccount('251000001');
    expect(ownReviews.getSnapshot()[111]).toEqual(own);
});

test('edição apagada pela moderação vira nova avaliação e falha de rede não duplica', async () => {
    ownReviews.set({ 111: own });
    respond = (request) => {
        if (request.method === 'PUT') throw new ApiError(404, 'Avaliação removida');
        return Response.json({ review: { id: 'nova' }, token: 'b'.repeat(64) });
    };
    await saveReview({ siape: 111, body: { rating: 80 } });
    expect(requests.map((request) => request.method)).toEqual(['PUT', 'POST']);
    expect(ownReviews.getSnapshot()[111]?.id).toBe('nova');
    requests = [];
    respond = () => {
        throw new ApiError(502, 'Indisponível');
    };
    const error = await saveReview({ siape: 111, body: { rating: 40 } }).catch(
        (reason: unknown) => reason
    );
    expect(error).toMatchObject({
        status: 502
    });
    expect(requests.map((request) => request.method)).toEqual(['PUT']);
});

test('exclusão atrasada não remove avaliação de outra conta e 404 limpa só a chave antiga', async () => {
    ownReviews.set({ 111: own });
    selectLocalAccount('252000002');
    ownReviews.set({ 111: { ...own, id: 'outra' } });
    selectLocalAccount('251000001');
    respond = () => {
        selectLocalAccount('252000002');
        throw new ApiError(404, 'Já apagada');
    };
    await deleteReview(111);
    expect(ownReviews.getSnapshot()[111]?.id).toBe('outra');
    selectLocalAccount('251000001');
    expect(ownReviews.getSnapshot()[111]).toBeUndefined();
});
