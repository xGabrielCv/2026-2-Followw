import type { ReactNode } from 'react';

import { PostHogProvider as BasePostHogProvider } from '@posthog/react';
import { posthog } from 'posthog-js';

if (typeof window !== 'undefined' && import.meta.env.VITE_POSTHOG_KEY) {
    posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
        api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
        person_profiles: 'identified_only',
        cross_subdomain_cookie: false,
        defaults: '2026-08-30',
        // nada da tela sai para a análise: sem gravação de sessão e sem textos ou atributos
        // (nome, IRA, menções e turmas aparecem na tela)
        disable_session_recording: true,
        mask_all_text: true,
        mask_all_element_attributes: true
    });
}

interface PostHogProviderProps {
    children: ReactNode;
}

export default function PostHogProvider({ children }: PostHogProviderProps) {
    return <BasePostHogProvider client={posthog}>{children}</BasePostHogProvider>;
}
