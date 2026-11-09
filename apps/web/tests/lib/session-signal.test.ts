import { expect, test } from 'bun:test';

import { announceSessionChange, subscribeSessionChanges } from '#/lib/session-signal';

import { useDom } from '../helpers/dom';

useDom();

test('avisa outras abas sem transmitir identidade e não reinicia a própria sessão', () => {
    window.localStorage.removeItem('followw:session-version');
    let changes = 0;
    const unsubscribe = subscribeSessionChanges(() => {
        changes++;
    });
    announceSessionChange();
    expect(changes).toBe(0);
    expect(window.localStorage.getItem('followw:session-version')).toBe('1');
    window.localStorage.setItem('followw:session-version', '2');
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'followw:session-version' }));
    expect(changes).toBe(1);
    window.dispatchEvent(new window.Event('pageshow'));
    expect(changes).toBe(1);
    unsubscribe();
    window.localStorage.setItem('followw:session-version', '3');
    window.dispatchEvent(new window.Event('focus'));
    expect(changes).toBe(1);
});
