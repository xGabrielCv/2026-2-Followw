import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';

const html = await Bun.file(
    new URL('../../../api/api/modules/admin/dashboard.html', import.meta.url)
).text();
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error('Script do painel ausente');

test.each(['/admin', '/api/admin', '/api/admin/'])(
    'primeiro acesso usa a API correta em %s e mostra confirmação de senha',
    async (path) => {
        const browser = new Window({ url: `http://localhost${path}` });
        const requests: string[] = [];
        browser.fetch = async (input) => {
            if (typeof input !== 'string') throw new Error('URL inesperada');
            requests.push(input);
            return new browser.Response(
                JSON.stringify({ enabled: false, setup: true, user: null })
            );
        };
        try {
            browser.document.write(html.replace(/<script>[\s\S]*?<\/script>/, ''));
            browser.eval(script);
            await browser.happyDOM.waitUntilComplete();
            expect(requests).toEqual([`${path.replace(/\/$/, '')}/api/session`]);
            expect(browser.document.querySelector('#login')?.textContent).toContain(
                'Criar o acesso'
            );
            expect(browser.document.querySelector('#password2')).not.toBeNull();
            expect(html).toContain('[hidden] { display:none !important; }');
        } finally {
            await browser.happyDOM.close();
        }
    }
);

test('falha de conexão no cadastro permite tentar novamente', async () => {
    const browser = new Window({ url: 'http://localhost/api/admin' });
    browser.fetch = async (input) => {
        if (typeof input === 'string' && input.endsWith('/setup')) throw new Error('Sem conexão');
        return new browser.Response(JSON.stringify({ enabled: false, setup: true, user: null }));
    };
    try {
        browser.document.write(html.replace(/<script>[\s\S]*?<\/script>/, ''));
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
