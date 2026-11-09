import type { ReactNode } from 'react';

import { PostHogProvider as BasePostHogProvider } from '@posthog/react';
import { posthog } from 'posthog-js';

import { localStorageRepository } from '#/lib/local-storage';

if (
    typeof window !== 'undefined' &&
    import.meta.env.VITE_POSTHOG_KEY &&
    localStorageRepository.get('analytics-consent') === true
) {
    posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
        api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
        person_profiles: 'identified_only',
        cross_subdomain_cookie: false,
        defaults: '2026-08-30',
        // nada da tela sai para a análise: sem gravação de sessão e sem textos ou atributos
        // (nome, IRA, menções e turmas aparecem na tela)
        disable_session_recording: true,
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        persistence: 'memory',
        mask_all_text: true,
        mask_all_element_attributes: true,
        before_send: (event) => {
            if (
                !event ||
                localStorageRepository.get('analytics-consent') !== true ||
                event.event !== 'login_session_lost'
            )
                return null;
            event.properties = { distinct_id: event.properties.distinct_id, $lib: 'web' };
            return event;
        }
    });
}

export function setAnalyticsConsent(allowed: boolean) {
    localStorageRepository.set('analytics-consent', allowed);
    if (!allowed) posthog.opt_out_capturing();
}

interface PostHogProviderProps {
    children: ReactNode;
}

export default function PostHogProvider({ children }: PostHogProviderProps) {
    return <BasePostHogProvider client={posthog}>{children}</BasePostHogProvider>;
}
