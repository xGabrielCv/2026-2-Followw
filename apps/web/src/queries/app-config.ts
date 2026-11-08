import type { components } from '#/queries/schema.gen';

import { api } from '#/queries/api';

export type AppConfig = components['schemas']['AppConfig'];
export type MenuKey = keyof AppConfig['menu'];

// o admin liga e desliga cartões do Mais; o app relê a cada poucos minutos
export const appConfigQueryOptions = api.queryOptions(
    'get',
    '/public/config',
    {},
    { staleTime: 5 * 60_000 }
);

// antes da configuração chegar: tudo à mostra, menos as ferramentas que dependem do admin
export const DEFAULT_HIDDEN = new Set(['automatricula', 'monitor']);

export function menuVisible(config: AppConfig | undefined, key: string): boolean {
    if (!config) return !DEFAULT_HIDDEN.has(key);
    return config.menu[key] ?? !DEFAULT_HIDDEN.has(key);
}
