import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { fileURLToPath } from 'node:url';

const html = await Bun.file(
    new URL('../../../api/api/modules/admin/dashboard.html', import.meta.url)
).text();
const build = await Bun.build({
    entrypoints: [
        fileURLToPath(new URL('../../../api/api/modules/admin/dashboard.js', import.meta.url))
    ],
    target: 'browser',
    format: 'iife'
});
if (!build.success) throw new Error('Módulos do painel não compilam');
const script = await build.outputs[0].text();
const css = await Bun.file(
    new URL('../../../api/api/modules/admin/dashboard.css', import.meta.url)
).text();

test.each(['/admin', '/api/admin', '/api/admin/'])(
    'primeiro acesso usa a API correta em %s e mostra confirmação de senha',
    async (path) => {
        const browser = new Window({
            url: `http://localhost${path}`,
            settings: { disableJavaScriptFileLoading: true }
        });
        const requests: string[] = [];
        browser.fetch = async (input) => {
            if (typeof input !== 'string') throw new Error('URL inesperada');
            requests.push(input);
            return new browser.Response(
                JSON.stringify({ enabled: false, setup: true, user: null })
            );
        };
        try {
            browser.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/, ''));
            browser.eval(script);
            await browser.happyDOM.waitUntilComplete();
            expect(requests).toEqual([`${path.replace(/\/$/, '')}/api/session`]);
            expect(browser.document.querySelector('#login')?.textContent).toContain(
                'Criar o acesso'
            );
            expect(browser.document.querySelector('#password2')).not.toBeNull();
            expect(css).toContain('[hidden] { display:none !important; }');
        } finally {
            await browser.happyDOM.close();
        }
    }
);

test('falha de conexão no cadastro permite tentar novamente', async () => {
    const browser = new Window({
        url: 'http://localhost/api/admin',
        settings: { disableJavaScriptFileLoading: true }
    });
    browser.fetch = async (input) => {
        if (typeof input === 'string' && input.endsWith('/setup')) throw new Error('Sem conexão');
        return new browser.Response(JSON.stringify({ enabled: false, setup: true, user: null }));
    };
    try {
        browser.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/, ''));
        browser.eval(script);
        await browser.happyDOM.waitUntilComplete();
        const form = browser.document.querySelector('form');
        if (!form) throw new Error('Formulário ausente');
        form.dispatchEvent(new browser.Event('submit', { cancelable: true }));
        await browser.happyDOM.waitUntilComplete();
        expect(browser.document.querySelector('#login-error')?.textContent).toContain(
            'Sem conexão'
        );
        expect(browser.document.querySelector('button')?.disabled).toBe(false);
    } finally {
        await browser.happyDOM.close();
    }
});

test('exportação CSV neutraliza fórmulas perigosas com aspa simples inicial', async () => {
    const corePath = fileURLToPath(
        new URL('../../../api/api/modules/admin/dashboard-core.js', import.meta.url)
    );
    const coreSrc = await Bun.file(corePath).text();
    expect(coreSrc).toContain('export function safeCsvCell');
    const browser = new Window({ url: 'http://localhost/api/admin' });
    const prevDoc = globalThis.document;
    const prevLoc = globalThis.location;
    Object.assign(globalThis, { document: browser.document, location: browser.location });
    try {
        const { safeCsvCell } = await import(corePath);
        expect(safeCsvCell('=CMD("calc")')).toBe(`"'=CMD(""calc"")"`);
        expect(safeCsvCell(' +SUM(A1:A2)')).toBe(`"' +SUM(A1:A2)"`);
        expect(safeCsvCell('@HYPERLINK("http://x")')).toBe(`"'@HYPERLINK(""http://x"")"`);
        expect(safeCsvCell('texto comum')).toBe('"texto comum"');
    } finally {
        Object.assign(globalThis, { document: prevDoc, location: prevLoc });
        await browser.happyDOM.close();
    }
});

test('hash #logs abre diretamente a aba de registros técnicos sem cair em visão geral', async () => {
    const browser = new Window({
        url: 'http://localhost/api/admin#logs',
        settings: { disableJavaScriptFileLoading: true }
    });
    const requests: string[] = [];
    browser.fetch = async (input) => {
        if (typeof input !== 'string') throw new Error('URL inesperada');
        requests.push(input);
        if (input.endsWith('/api/session')) {
            return new browser.Response(
                JSON.stringify({
                    enabled: true,
                    setup: false,
                    user: {
                        id: '11111111-1111-1111-1111-111111111111',
                        username: 'owner_local',
                        role: 'owner',
                        permissions: ['operations', 'audit', 'owner']
                    }
                })
            );
        }
        if (input.endsWith('/api/logs/summary')) {
            return new browser.Response(
                JSON.stringify({
                    stored_total: 0,
                    retention_days: 30,
                    max_rows: 50000,
                    last_24_hours: { INFO: 0, WARNING: 0, ERROR: 0 },
                    top_events: []
                })
            );
        }
        if (input.includes('/api/logs')) {
            return new browser.Response(
                JSON.stringify({
                    total: 0,
                    items: [],
                    retention_days: 30,
                    max_rows: 50000,
                    by_level: {}
                })
            );
        }
        return new browser.Response(JSON.stringify({}));
    };
    try {
        browser.document.write(html.replace(/<script[^>]*>[\s\S]*?<\/script>/, ''));
        browser.eval(script);
        await browser.happyDOM.waitUntilComplete();
        expect(requests.some((u) => u.includes('/api/logs'))).toBe(true);
        expect(requests.some((u) => u.endsWith('/api/overview'))).toBe(false);
        expect(browser.document.querySelector('#main')?.textContent).toContain(
            'Registros técnicos'
        );
    } finally {
        await browser.happyDOM.close();
    }
});
