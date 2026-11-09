import { resolve } from 'node:path';

const node = Bun.which('node');
if (!node) throw new Error('Node necessário para validar o build de produção');
const child = Bun.spawn([node, resolve('.output/server/index.mjs')], {
    env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: '3013',
        NITRO_HOST: '127.0.0.1',
        NITRO_PORT: '3013',
        API_INTERNAL_URL: 'http://127.0.0.1:8011'
    },
    stdout: 'inherit',
    stderr: 'inherit'
});

const gateway = Bun.serve({
    hostname: '127.0.0.1',
    port: 3011,
    async fetch(request) {
        const path = new URL(request.url);
        const port = path.pathname.startsWith('/api/') ? 8011 : 3013;
        const target = new URL(path.pathname + path.search, `http://127.0.0.1:${port}`);
        try {
            // oxlint-disable-next-line no-restricted-globals -- proxy E2E sem acesso ao cliente do aplicativo
            const response = await fetch(new Request(target, request), { redirect: 'manual' });
            const headers = new Headers(response.headers);
            // O transporte já descomprime o corpo; o proxy mantém o conteúdo e os cookies separados.
            headers.delete('content-encoding');
            headers.delete('content-length');
            return new Response(response.body, { status: response.status, headers });
        } catch {
            return new Response('Instância sintética iniciando', { status: 503 });
        }
    }
});

function stop() {
    void gateway.stop(true);
    child.kill();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
await child.exited;
void gateway.stop(true);
