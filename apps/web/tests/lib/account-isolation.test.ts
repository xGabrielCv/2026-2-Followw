import { afterEach, expect, test } from 'bun:test';

import { authorSecret } from '#/lib/author';
import {
    clearAccountStorage,
    localStorageRepository,
    selectLocalAccount
} from '#/lib/local-storage';

import { useDom } from '../helpers/dom';

useDom();
afterEach(() => {
    localStorageRepository.clear();
    selectLocalAccount();
});

test('duas contas preservam grades e autoria próprias, sem herdar segredos ao sair', () => {
    selectLocalAccount('251000001');
    const authorA = authorSecret();
    localStorageRepository.set('schedule-plans', { name: 'Plano A' });
    localStorageRepository.set('reviews', { secret: 'revisao-a' });
    selectLocalAccount('252000002');
    expect(localStorageRepository.get('schedule-plans')).toBeNull();
    expect(localStorageRepository.get('reviews')).toBeNull();
    expect(authorSecret()).not.toBe(authorA);
    localStorageRepository.set('schedule-plans', { name: 'Plano B' });
    clearAccountStorage();
    expect(localStorageRepository.get('schedule-plans')).toBeNull();
    selectLocalAccount('251000001');
    expect(authorSecret()).toBe(authorA);
    expect(localStorageRepository.get('schedule-plans')).toEqual({ name: 'Plano A' });
    expect(localStorageRepository.get('reviews')).toEqual({ secret: 'revisao-a' });
    selectLocalAccount('252000002');
    expect(localStorageRepository.get('schedule-plans')).toEqual({ name: 'Plano B' });
});
