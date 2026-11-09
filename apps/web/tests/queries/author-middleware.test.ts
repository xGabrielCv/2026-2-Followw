import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { keyFor, validAuthor } from '#/lib/author';
import { localStorageRepository, selectLocalAccount } from '#/lib/local-storage';
import { apiClient } from '#/queries/client';

import { useDom } from '../helpers/dom';

useDom();

const ID = '11111111-1111-4111-8111-111111111111';
const RESP = '22222222-2222-4222-8222-222222222222';
const OUTRO = '33333333-3333-4333-8333-333333333333';

describe('chaves de autoria nos pedidos', () => {
    let sent: Request[];
    let created: string | undefined;

    // sem rede: devolve o que o servidor devolveria e guarda o pedido final (com os cabeçalhos postos)
    const fakeFetch = async (input: Request) => {
        sent.push(input.clone());
        return new Response(JSON.stringify({ id: created ?? ID }), {
            status: 201,
            headers: {
                'content-type': 'application/json',
                ...(created ? { 'x-created-id': created } : {})
            }
        });
    };
    // as rotas dinâmicas só existem neste teste: o cliente tipado vira um despachante genérico
    type Dispatch = (path: string, init: object) => Promise<unknown>;
    const call = (method: 'GET' | 'POST' | 'DELETE', path: string, body?: object) => {
        const dispatch = Reflect.get(apiClient, method);
        if (typeof dispatch !== 'function') throw new Error('método ausente');
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- despachante genérico de teste
        return (dispatch as Dispatch).call(apiClient, path, { body, fetch: fakeFetch });
    };

    beforeEach(() => {
        sent = [];
        created = undefined;
    });
    afterEach(() => {
        localStorageRepository.clear();
        selectLocalAccount();
    });

    test('cada publicação criada usa uma chave nova e a guarda com o id devolvido pelo servidor', async () => {
        created = ID;
        await call('POST', '/forum', { kind: 'duvida', title: 'Título bom', body: 'texto' });
        created = OUTRO;
        await call('POST', '/forum', { kind: 'duvida', title: 'Outro título', body: 'texto' });
        const [a, b] = sent.map((request) => request.headers.get('X-Followw-Author'));
        expect(validAuthor(a) && validAuthor(b)).toBe(true);
        expect(a).not.toBe(b);
        expect(keyFor('post', ID)).toBe(a ?? undefined);
        expect(keyFor('post', OUTRO)).toBe(b ?? undefined);
    });

    test('responder: chave própria da resposta e prova de quem abriu a conversa', async () => {
        created = ID;
        await call('POST', '/forum', { kind: 'duvida', title: 'Título bom', body: 'texto' });
        const chavePost = keyFor('post', ID);
        created = RESP;
        await call('POST', `/forum/${ID}/replies`, { body: 'resposta' });
        const reply = sent.at(-1)!;
        expect(reply.headers.get('X-Followw-Op-Key')).toBe(chavePost ?? null);
        expect(reply.headers.get('X-Followw-Author')).not.toBe(chavePost ?? null);
        expect(keyFor('reply', RESP)).toBe(reply.headers.get('X-Followw-Author') ?? undefined);
    });

    test('apagar usa a chave da própria publicação; sem ela não manda chave nenhuma', async () => {
        created = ID;
        await call('POST', '/forum', { kind: 'duvida', title: 'Título bom', body: 'texto' });
        const chave = keyFor('post', ID);
        await call('DELETE', `/forum/${ID}`);
        expect(sent.at(-1)!.headers.get('X-Followw-Author')).toBe(chave ?? null);
        await call('DELETE', `/forum/${RESP}`);
        expect(sent.at(-1)!.headers.get('X-Followw-Author')).toBeNull();
    });

    test('leituras e outros pedidos não levam nenhum identificador', async () => {
        await call('GET', '/forum');
        await call('GET', '/public/config');
        for (const request of sent) {
            expect(request.headers.get('X-Followw-Author')).toBeNull();
            expect(request.headers.get('X-Followw-Usage')).toBeNull();
        }
    });
});
