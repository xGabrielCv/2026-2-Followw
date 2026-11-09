import { expect, test } from '@playwright/test';

test.skip(process.env.FOLLOWW_E2E_PRODUCTION !== '1', 'Validação do servidor de produção');

test('produção hidrata com nonce único e rejeita scripts inline sem autorização', async ({
    page,
    request
}) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error' && /Content Security Policy|hydration/i.test(message.text()))
            errors.push(message.text());
    });
    const response = await page.goto('/login');
    await expect(page.locator('body')).toHaveAttribute('data-app-ready', 'true');
    const policy = response?.headers()['content-security-policy'] ?? '';
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{24}$/);
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain('unsafe-eval');
    const scripts = await page
        .locator('script')
        .evaluateAll((elements) =>
            elements
                .filter(
                    (element): element is HTMLScriptElement =>
                        element instanceof HTMLScriptElement &&
                        !element.src &&
                        element.type !== 'application/ld+json'
                )
                .map((element) => element.nonce)
        );
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.every((value) => value === nonce)).toBe(true);
    expect(errors).toEqual([]);
    const second = await request.get('/login', {
        headers: { 'X-Followw-Csp-Nonce': 'nonce-forjado' }
    });
    const next = /'nonce-([^']+)'/.exec(second.headers()['content-security-policy'] ?? '')?.[1];
    expect(next).toBeTruthy();
    expect(next).not.toBe(nonce);
    expect(next).not.toBe('nonce-forjado');
    await page.evaluate(() => {
        const element = document.createElement('script');
        element.textContent = 'document.body.dataset.inlineInseguro = "executado"';
        document.body.append(element);
    });
    await expect(page.locator('body')).not.toHaveAttribute('data-inline-inseguro', 'executado');
});
