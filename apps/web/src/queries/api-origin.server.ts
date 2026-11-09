/** O destino interno é da instância; Host e Forwarded recebidos nunca escolhem para onde enviar cookies. */
export function serverApiUrl(path: string): URL {
    let origin = process.env.API_INTERNAL_URL;
    if (!origin) {
        const port = process.env.API_PORT ?? '8000';
        if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535)
            throw new Error('Porta interna da API inválida');
        origin = `http://127.0.0.1:${port}`;
    }
    let base: URL;
    try {
        base = new URL(origin);
    } catch {
        throw new Error('Origem interna da API inválida');
    }
    if (
        !['http:', 'https:'].includes(base.protocol) ||
        base.username ||
        base.password ||
        base.search ||
        base.hash ||
        base.pathname !== '/'
    )
        throw new Error('Origem interna da API inválida');
    if (!path.startsWith('/api/')) throw new Error('Caminho interno da API inválido');
    const url = new URL(path, base);
    if (url.origin !== base.origin || !url.pathname.startsWith('/api/'))
        throw new Error('Caminho interno da API inválido');
    return url;
}
