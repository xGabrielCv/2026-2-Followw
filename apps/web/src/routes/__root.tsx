import type { QueryClient } from '@tanstack/react-query';

import { IsRestoringProvider } from '@tanstack/react-query';
import {
    HeadContent,
    Outlet,
    Scripts,
    createRootRouteWithContext,
    useRouter,
    isNotFound
} from '@tanstack/react-router';
import { NuqsAdapter } from 'nuqs/adapters/tanstack-router';
import { useEffect } from 'react';

import { ErrorPage } from '#/components/ErrorPage';
import { NotFoundPage } from '#/components/NotFoundPage';
import { initializeInstallSupport } from '#/integrations/offline/install';
import { useOfflineSupport } from '#/integrations/offline/use-offline-support';
import { reloadOnPreloadError } from '#/lib/chunk-reload';
import { layoutScript } from '#/lib/layout';
import { observeLocalStorage, selectLocalAccount } from '#/lib/local-storage';
import { initializeLocalVault } from '#/lib/local-vault';
import { themeScript } from '#/lib/theme';
import { observeViewport } from '#/lib/viewport';
import { useSessionRefresh } from '#/queries/auth';
import { loadQuery } from '#/queries/load';
import { meQueryOptions } from '#/queries/me';
import appCss from '#/styles.css?url';

interface MyRouterContext {
    queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
    beforeLoad: async ({ context }) => {
        await initializeLocalVault();
        if (typeof window !== 'undefined') {
            const user = await loadQuery(context.queryClient, meQueryOptions);
            selectLocalAccount(user?.registration);
        }
    },
    head: ({ match }) => ({
        meta: [
            { charSet: 'utf-8' },
            {
                name: 'viewport',
                content: 'width=device-width, initial-scale=1'
            },
            { name: 'theme-color', content: '#007c5d' },
            { name: 'apple-mobile-web-app-capable', content: 'yes' },
            { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
            { name: 'apple-mobile-web-app-title', content: 'Followw' },
            { name: 'description', content: 'O Followw é sua nova forma de usar o SIGAA UnB.' },
            // Apenas as páginas públicas sobrescrevem esta regra para permitir indexação.
            { name: 'robots', content: 'noindex, follow' },
            { title: isNotFound(match?.error) ? 'Página não encontrada | Followw' : 'Followw' }
        ],
        links: [
            { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
            { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
            { rel: 'apple-touch-icon', href: '/apple-touch-icon.png?v=2' },
            { rel: 'manifest', href: '/manifest.json' },
            { rel: 'stylesheet', href: appCss }
        ]
    }),
    shellComponent: RootDocument,
    errorComponent: ErrorPage,
    notFoundComponent: NotFoundPage,
    component: RootComponent
});

function RootComponent() {
    useSessionRefresh();
    useEffect(observeViewport, []);
    useEffect(observeLocalStorage, []);
    useEffect(() => {
        document.body.dataset.appReady = 'true';
        return () => {
            delete document.body.dataset.appReady;
        };
    }, []);
    useEffect(() => reloadOnPreloadError(), []);
    useEffect(() => initializeInstallSupport(), []);
    const restoring = useOfflineSupport();

    return (
        <IsRestoringProvider value={restoring}>
            <NuqsAdapter>
                <Outlet />
            </NuqsAdapter>
        </IsRestoringProvider>
    );
}

function RootDocument({ children }: { children: React.ReactNode }) {
    const nonce = useRouter().options.ssr?.nonce;
    return (
        <html lang="pt-BR" suppressHydrationWarning>
            <head>
                <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
                <script nonce={nonce} dangerouslySetInnerHTML={{ __html: layoutScript }} />
                <HeadContent />
            </head>
            <body>
                {children}
                <Scripts />
            </body>
        </html>
    );
}
