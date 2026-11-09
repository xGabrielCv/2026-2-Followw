import { expect, test } from 'bun:test';

import { validDate } from '#/lib/date';

test('rejeita datas inválidas sem lançar exceção e aceita ano bissexto', () => {
    for (const value of [
        '2026-99-99',
        '2026-02-29',
        '2026-00-01',
        '2026-04-31',
        '',
        'abc',
        '2026-1-1'
    ]) {
        expect(validDate(value)).toBe(false);
    }
    expect(validDate('2028-02-29')).toBe(true);
    expect(validDate('2026-11-08')).toBe(true);
});
