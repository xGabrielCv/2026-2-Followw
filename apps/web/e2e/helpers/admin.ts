import { expect, type Page } from '@playwright/test';
import { createHmac } from 'node:crypto';

function code(secret: string) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const bits = Array.from(secret)
        .map((char) => alphabet.indexOf(char).toString(2).padStart(5, '0'))
        .join('');
    const bytes = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
    const digest = createHmac('sha1', bytes).update(counter).digest();
    const offset = digest[digest.length - 1] & 15;
    return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}

export async function setupOwner(page: Page) {
    const headers = { 'X-Admin-Request': '1' };
    expect(
        (
            await page.request.post('/api/admin/api/setup', {
                headers,
                data: { username: 'owner-sintetico', password: 'senha-sintetica-somente-e2e' }
            })
        ).status()
    ).toBe(200);
    const enrollment = await (await page.request.get('/api/admin/api/mfa/enroll')).json();
    expect(
        (
            await page.request.post('/api/admin/api/mfa/confirm', {
                headers,
                data: { code: code(enrollment.secret) }
            })
        ).status()
    ).toBe(200);
}
