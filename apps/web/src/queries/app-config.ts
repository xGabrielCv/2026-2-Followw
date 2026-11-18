import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { components } from '#/queries/schema.gen';

import { setCustomSemesters } from '#/calendar';
import { api } from '#/queries/api';

export type AppConfig = components['schemas']['AppConfig'];
export type SemesterAlertConfig = components['schemas']['SemesterAlertConfig'];
export type MenuKey = keyof AppConfig['menu'];

// o admin liga e desliga funções e avisa semestres; o app relê quando config muda
export const appConfigQueryOptions = api.queryOptions(
    'get',
    '/public/config',
    {},
    { staleTime: 60_000, refetchInterval: 60_000, refetchOnWindowFocus: 'always' }
);

export function useAppConfig() {
    const query = useQuery(appConfigQueryOptions);
    const calendar = query.data?.calendar;
    useEffect(() => {
        setCustomSemesters(calendar ?? {});
    }, [calendar]);
    return {
        config: query.data,
        calendar,
        allowCurrentSchedule: Boolean(query.data?.flags?.current_plan),
        alert: query.data?.alert
    };
}

// antes da configuração chegar: tudo à mostra, menos as ferramentas que dependem do admin
export const DEFAULT_HIDDEN = new Set(['automatricula', 'monitor']);

export function menuVisible(config: Pick<AppConfig, 'menu'> | undefined, key: string): boolean {
    if (!config) return !DEFAULT_HIDDEN.has(key);
    return config.menu[key] ?? !DEFAULT_HIDDEN.has(key);
}
