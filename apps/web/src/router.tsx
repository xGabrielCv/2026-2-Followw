import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query';
import { createIsomorphicFn } from '@tanstack/react-start';
import { getRequestHeader } from '@tanstack/react-start/server';

import { ErrorPage } from '#/components/ErrorPage';
import { PendingPage } from '#/components/PendingPage';
import { getContext } from '#/integrations/tanstack-query/root-provider';
import { parseRouterSearch, stringifyRouterSearch } from '#/lib/search-params';
import { routeTree } from '#/routeTree.gen';

const requestNonce = createIsomorphicFn()
    .client(() => document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')?.content)
    .server(() => {
        try {
            return getRequestHeader('X-Followw-Csp-Nonce');
        } catch {
            return undefined;
        }
    });

export function getRouter() {
    const context = getContext();
    const nonce = requestNonce();

    const router = createTanStackRouter({
        routeTree,
        ssr: { nonce },
        context,
        parseSearch: parseRouterSearch,
        stringifySearch: stringifyRouterSearch,
        defaultErrorComponent: ErrorPage,
        defaultPendingComponent: PendingPage,
        defaultPendingMs: 200,
        scrollRestoration: true,
        defaultPreload: 'intent',
        defaultPreloadStaleTime: 0
    });

    setupRouterSsrQueryIntegration({ router, queryClient: context.queryClient });

    return router;
}

declare module '@tanstack/react-router' {
    interface Register {
        router: ReturnType<typeof getRouter>;
    }
}
