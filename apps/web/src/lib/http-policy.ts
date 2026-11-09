export const publicRouteRules = {
    '/admin': { redirect: '/api/admin' },
    '/**': {
        headers: {
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'private, no-store',
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'X-Frame-Options': 'DENY',
            'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()'
        }
    },
    '/assets/**': {
        headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }
    }
};

export function contentSecurityPolicy(nonce: string) {
    if (!/^[A-Za-z0-9+/]{24}$/.test(nonce)) throw new Error('Nonce inválido');
    return [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}'`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https://sigaa.unb.br",
        "font-src 'self'",
        "connect-src 'self'",
        "worker-src 'self'",
        "frame-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'"
    ].join('; ');
}
