import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
    RouterProvider,
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter
} from '@tanstack/react-router';
import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { renderToStaticMarkup } from 'react-dom/server';

import { meQueryOptions } from '#/queries/me';
import { Route as LoginRoute } from '#/routes/login';
import { Route as PrivacyRoute } from '#/routes/privacidade';

async function renderPage(path: string, user: { name: string } | null = null) {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    client.setQueryData<{ name: string } | null>(meQueryOptions.queryKey, user);
    const root = createRootRoute();
    const privacy = createRoute({
        getParentRoute: () => root,
        path: '/privacidade',
        component: PrivacyRoute.options.component
    });
    const login = createRoute({
        getParentRoute: () => root,
        path: '/login',
        component: LoginRoute.options.component
    });
    const router = createRouter({
        routeTree: root.addChildren([privacy, login]),
        history: createMemoryHistory({ initialEntries: [path] })
    });
    await router.load();
    try {
        return renderToStaticMarkup(
            <QueryClientProvider client={client}>
                <RouterProvider router={router} />
            </QueryClientProvider>
        );
    } finally {
        client.clear();
    }
}

describe('privacidade e termos', () => {
    test.each([null, { name: 'Estudante' }])(
        'permite consultar a página sem exigir ou redirecionar a sessão %p',
        async (user) => {
            expect(PrivacyRoute.options.loader).toBeUndefined();
            expect(PrivacyRoute.options.beforeLoad).toBeUndefined();
            const markup = await renderPage('/privacidade', user);
            expect(markup).toContain('Política de privacidade');
            expect(markup).toContain('Termos de serviço');
            expect(markup).toContain('href="/login"');
        }
    );

    test('explica que dado pessoal não fica no servidor, a cifra da comunidade e a análise de uso', async () => {
        const markup = await renderPage('/privacidade');
        expect(markup).toContain('Não gravamos seus dados pessoais do SIGAA no servidor');
        expect(markup).toContain('cookie cifrado');
        expect(markup).toContain('AES-256-GCM');
        expect(markup).toContain('30 dias por padrão');
        expect(markup).toContain('8 horas');
        expect(markup).not.toContain('PostHog');
        expect(markup).toContain('rastreador externo nem gravação de sessão');
        expect(markup).toContain('uma autorização curta e de uso único');
        expect(markup).toContain('não prometemos anonimato absoluto');
        expect(markup).not.toContain('não exigem login para publicar');
        expect(markup).not.toContain('mailto:');
        expect(markup).not.toContain('contato@followw.app');
        expect(markup).not.toContain('removal@followw.app');
        expect(markup).toContain('leitura é pública');
        expect(markup).toContain('cifrados no navegador');
        expect(markup).toContain('texto aberto');
        expect(markup).not.toContain('Guardamos em nosso banco de dados cópias');
        expect(markup).toContain('stalking');
        expect(markup).toContain('automações são permitidos');
    });

    test('rodapé do login oferece links para privacidade e termos de serviço', async () => {
        const browser = new Window();
        try {
            browser.document.body.innerHTML = await renderPage('/login');
            const links = [...browser.document.querySelectorAll('footer a')].map((link) => ({
                text: link.textContent,
                href: link.getAttribute('href')
            }));
            expect(links).toEqual([
                { text: 'Política de privacidade', href: '/privacidade#politica-de-privacidade' },
                { text: 'Termos de serviço', href: '/privacidade#termos-de-servico' }
            ]);
        } finally {
            await browser.happyDOM.abort();
        }
    });
});
