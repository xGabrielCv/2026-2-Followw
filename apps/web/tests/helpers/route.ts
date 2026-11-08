import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { AnyRoute } from '@tanstack/react-router';

import { environmentManager } from '@tanstack/react-query';
import { afterAll, beforeAll } from 'bun:test';

// QueryClient sem cache que responde cada query pela chave
export function fakeQueryClient(
    respond: (queryKey: QueryKey) => unknown,
    // o que já está salvo no navegador (o dado pessoal só abre a página com o que já tem)
    cached: (queryKey: QueryKey) => unknown = () => undefined
) {
    const client = {
        getQueryData: (queryKey: QueryKey) => cached(queryKey),
        query: async ({ queryKey }: { queryKey: QueryKey }) => respond(queryKey)
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- fake parcial
    return client as unknown as QueryClient;
}

type RouteFn<T> = Extract<T, (...args: never[]) => unknown>;

// chama loader, head, beforeLoad etc. só com a parte do contexto que o teste usa
export function callRoute<T>(option: T, context: object = {}): ReturnType<RouteFn<T>> {
    if (typeof option !== 'function') throw new Error('Opção da rota não é uma função');
    return option(context);
}

// o tipo de options.loader inclui um RouteLoaderFn genérico que devolve any
export function runLoader<R extends AnyRoute>(
    route: R,
    context: object
): Promise<R['types']['loaderData']> {
    return callRoute(route.options.loader, context);
}

/** Roda os testes como no navegador: lá o loader busca o dado pessoal; no SSR, não. */
export function useBrowserEnvironment() {
    beforeAll(() => environmentManager.setIsServer(() => false));
    afterAll(() => environmentManager.setIsServer(() => typeof window === 'undefined'));
}
