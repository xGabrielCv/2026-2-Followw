import { expect, test } from 'bun:test';
import deepmerge from 'deepmerge';

test.each(['target', 'source'])('deepmerge não modifica protótipo por chaves do %s', (side) => {
    const malicious: object = JSON.parse('{"__proto__":{"poisoned":true},"safe":{"value":1}}');
    const result =
        side === 'target' ? deepmerge(malicious, {}) : deepmerge(Object.create(null), malicious);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(false);
    expect(result).toMatchObject({ safe: { value: 1 } });
});
