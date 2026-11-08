import { afterEach, expect, test } from 'bun:test';

import {
    isLayoutMode,
    layoutScript,
    readLayoutMode,
    saveLayoutMode,
    subscribeLayoutMode
} from '#/lib/layout';

import { useDom } from '../helpers/dom';

useDom();
afterEach(() => saveLayoutMode('auto'));

test('o padrão é automático e só os modos conhecidos valem', () => {
    expect(readLayoutMode()).toBe('auto');
    expect(isLayoutMode('desktop')).toBe(true);
    expect(isLayoutMode('tablet')).toBe(false);
});

test('forçar o celular marca o html e avisa quem acompanha', () => {
    const calls: string[] = [];
    const unsubscribe = subscribeLayoutMode(() => calls.push(readLayoutMode()));

    saveLayoutMode('mobile');
    expect(document.documentElement.dataset.layout).toBe('mobile');
    expect(localStorage.getItem('followw:layout')).toBe('"mobile"');

    saveLayoutMode('auto');
    expect(document.documentElement.dataset.layout).toBeUndefined();
    expect(localStorage.getItem('followw:layout')).toBeNull();
    expect(calls).toEqual(['mobile', 'auto']);
    unsubscribe();
});

test('o script do head lê a mesma chave', () => {
    expect(layoutScript).toContain("'followw:layout'");
});
