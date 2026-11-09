import { afterEach, describe, expect, test } from 'bun:test';

import {
    applyMigration,
    forgetKey,
    keyFor,
    legacySecret,
    newKey,
    rememberKey,
    setAuthorSecret,
    shareKeys,
    usageHeader,
    validAuthor
} from '#/lib/author';
import { localStorageRepository, selectLocalAccount } from '#/lib/local-storage';

import { useDom } from '../helpers/dom';

useDom();
afterEach(() => {
    localStorageRepository.clear();
    selectLocalAccount();
});

describe('credenciais por publicação', () => {
    test('toda chave nova é aleatória, de 256 bits e diferente das outras', () => {
        const keys = Array.from({ length: 500 }, newKey);
        expect(new Set(keys).size).toBe(500);
        expect(keys.every(validAuthor)).toBe(true);
    });

    test('cada publicação guarda a própria chave; esquecer uma não afeta as outras', () => {
        const [a, b] = [newKey(), newKey()];
        rememberKey('post', 'p1', a);
        rememberKey('reply', 'r1', b);
        expect(keyFor('post', 'p1')).toBe(a);
        expect(keyFor('reply', 'r1')).toBe(b);
        expect(keyFor('post', 'r1')).toBeUndefined();
        forgetKey('post', 'p1');
        expect(keyFor('post', 'p1')).toBeUndefined();
        expect(keyFor('reply', 'r1')).toBe(b);
    });

    test('chave inválida não é guardada', () => {
        rememberKey('post', 'p1', 'curta');
        rememberKey('post', 'p2', '251000000');
        expect(keyFor('post', 'p1')).toBeUndefined();
        expect(keyFor('post', 'p2')).toBeUndefined();
    });

    test('duas contas não enxergam as chaves uma da outra', () => {
        selectLocalAccount('251000001');
        rememberKey('material', 'm1', newKey());
        selectLocalAccount('252000002');
        expect(keyFor('material', 'm1')).toBeUndefined();
    });

    test('a migração troca o segredo antigo por chaves novas e o descarta', () => {
        const old = 'a'.repeat(64);
        setAuthorSecret(old);
        expect(legacySecret()).toBe(old);
        const novas = { 'post:p1': newKey(), 'reply:r1': newKey(), 'share:t1': newKey() };
        applyMigration(novas);
        expect(legacySecret()).toBeUndefined();
        expect(keyFor('post', 'p1')).toBe(novas['post:p1']);
        expect(shareKeys()).toEqual({ t1: novas['share:t1'] });
    });
});

const dia = (iso: string) => new Date(`${iso}T12:00:00`);

describe('chaves de uso opcional', () => {
    test('três chaves aleatórias distintas, estáveis no mesmo dia', () => {
        const first = usageHeader(dia('2026-11-09')).split(',');
        expect(first).toHaveLength(3);
        expect(new Set(first).size).toBe(3);
        expect(first.every(validAuthor)).toBe(true);
        expect(usageHeader(dia('2026-11-09')).split(',')).toEqual(first);
    });

    test('no dia seguinte só a do dia muda; semana e mês seguem até virarem', () => {
        const [d1, w1, m1] = usageHeader(dia('2026-11-09')).split(',');
        const [d2, w2, m2] = usageHeader(dia('2026-11-10')).split(',');
        expect(d2).not.toBe(d1);
        expect([w2, m2]).toEqual([w1, m1]);
        const [, w3, m3] = usageHeader(dia('2026-12-01')).split(',');
        expect(m3).not.toBe(m1);
        expect(w3).not.toBe(w1);
    });
});
