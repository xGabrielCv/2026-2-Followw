import {
    RouterProvider,
    createMemoryHistory,
    createRootRoute,
    createRouter
} from '@tanstack/react-router';
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { LoginPrivacyInfo } from '#/components/auth/LoginPrivacyInfo';

describe('LoginPrivacyInfo', () => {
    test('mostra o resumo do uso de dados e leva à página completa', async () => {
        const router = createRouter({
            routeTree: createRootRoute({ component: LoginPrivacyInfo }),
            history: createMemoryHistory({ initialEntries: ['/'] })
        });
        await router.load();
        const markup = renderToStaticMarkup(<RouterProvider router={router} />);

        expect(markup).toContain('Seus dados pessoais não ficam no servidor do Followw');
        expect(markup).toContain('cookies cifrados no navegador');
        expect(markup).toContain('não são gravadas no banco ou nos logs');
        expect(markup).toContain('href="/perfil/dados"');
    });
});
