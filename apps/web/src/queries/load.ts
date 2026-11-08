import {
    type QueryExecuteOptions,
    type QueryClient,
    type QueryKey,
    environmentManager,
    noop
} from '@tanstack/react-query';

// loaders: com dado em cache resolve na hora e revalida em segundo plano; sem cache, espera a rede
export function loadQuery<TData, TError, TQueryKey extends QueryKey>(
    queryClient: QueryClient,
    options: QueryExecuteOptions<TData, TError, TData, TData, TQueryKey>
): Promise<TData> {
    const cached = queryClient.getQueryData<TData>(options.queryKey);
    const request = queryClient.query(options);
    if (cached === undefined) return request;
    request.catch(noop);
    return Promise.resolve(cached);
}

/**
 * Dado pessoal (turmas, frequência, postagens): a API o busca no SIGAA na hora, então o SSR
 * nunca espera por ele. No navegador, devolve o que já está salvo e atualiza em segundo plano;
 * sem nada salvo, a tela mostra o carregamento enquanto a busca segue.
 */
export function loadPersonal<TData, TError, TQueryKey extends QueryKey>(
    queryClient: QueryClient,
    options: QueryExecuteOptions<TData, TError, TData, TData, TQueryKey>
): Promise<TData | undefined> {
    if (environmentManager.isServer()) return Promise.resolve(undefined);
    queryClient.query(options).catch(noop);
    return Promise.resolve(queryClient.getQueryData<TData>(options.queryKey));
}
