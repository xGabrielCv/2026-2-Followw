import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';

import { rememberKey, setAuthorSecret } from '#/lib/author';
import { localStorageRepository, selectLocalAccount } from '#/lib/local-storage';
import { parseSupportReference, supportAuthorProof } from '#/lib/support-reference';
import { ownReviews } from '#/queries/reviews';

import { useDom } from '../helpers/dom';

useDom();

const id = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';

beforeEach(() => selectLocalAccount('251000001'));
afterEach(() => {
    localStorageRepository.clear();
    selectLocalAccount();
});

for (const token of ['a'.repeat(64), 'A_b-'.repeat(10) + 'xyz']) {
    test(`usa a credencial de ${token.length} caracteres da avaliação com o UUID informado`, () => {
        ownReviews.set({ 111: { id, token, rating: 80 } });
        const reference = parseSupportReference(`review:${id}`);
        expect(reference).toEqual({ type: 'review', id });
        if (!reference) throw new Error('Referência inválida');
        const random = spyOn(crypto, 'getRandomValues');
        try {
            expect(supportAuthorProof(reference)).toBe(token);
            expect(random).not.toHaveBeenCalled();
            expect(ownReviews.getSnapshot()[111]?.token).toBe(token);
        } finally {
            random.mockRestore();
        }
    });
}

test('não usa a credencial de avaliação com outro UUID nem segredo antigo de aparelho', () => {
    ownReviews.set({ 111: { id, token: 'a'.repeat(64), rating: 80 } });
    setAuthorSecret('b'.repeat(64));
    expect(supportAuthorProof({ type: 'review', id: otherId })).toBeUndefined();
});

test('não busca a credencial de avaliação em outra conta local', () => {
    ownReviews.set({ 111: { id, token: 'a'.repeat(64), rating: 80 } });
    selectLocalAccount('252000002');
    ownReviews.set({ 222: { id: otherId, token: 'b'.repeat(64), rating: 70 } });
    expect(supportAuthorProof({ type: 'review', id })).toBeUndefined();
    expect(supportAuthorProof({ type: 'review', id: otherId })).toBe('b'.repeat(64));
    selectLocalAccount('251000001');
    expect(supportAuthorProof({ type: 'review', id })).toBe('a'.repeat(64));
    expect(supportAuthorProof({ type: 'review', id: otherId })).toBeUndefined();
});

test('reutiliza só chaves existentes de publicações e não inventa prova para grupos', () => {
    for (const type of ['post', 'reply', 'material', 'tutorial'] as const) {
        expect(supportAuthorProof({ type, id })).toBeUndefined();
        rememberKey(type, id, 'c'.repeat(64));
        expect(supportAuthorProof({ type, id })).toBe('c'.repeat(64));
        expect(supportAuthorProof({ type, id: otherId })).toBeUndefined();
    }
    expect(supportAuthorProof({ type: 'group', id })).toBeUndefined();
});

test('referência pública não contém credencial de autoria', () => {
    ownReviews.set({ 111: { id, token: 'a'.repeat(64), rating: 80 } });
    expect(parseSupportReference(`review:${id}:${'a'.repeat(64)}`)).toBeNull();
    expect(parseSupportReference(`review:${id}`)).toEqual({ type: 'review', id });
});
