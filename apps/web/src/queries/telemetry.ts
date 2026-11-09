import { localStorageRepository } from '#/lib/local-storage';

const pending = new Set<AbortController>();
export type TechnicalEvent = 'login_session_lost';

export function metricsAllowed() {
    return localStorageRepository.get('analytics-consent') === true;
}

export function setAnalyticsConsent(allowed: boolean) {
    localStorageRepository.set('analytics-consent', allowed);
    if (!allowed) {
        for (const controller of pending) controller.abort();
        pending.clear();
    }
}

/** Sem SDK, identificador, cookies, referrer, URL da tela ou mensagens de erro. */
export async function sendTechnicalEvent(event: TechnicalEvent) {
    if (!metricsAllowed() || event !== 'login_session_lost') return;
    const controller = new AbortController();
    pending.add(controller);
    const revoke = () => {
        if (!metricsAllowed()) controller.abort();
    };
    if (typeof window !== 'undefined') window.addEventListener('storage', revoke);
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
        await globalThis.fetch('/api/public/config/metrics', {
            method: 'POST',
            body: JSON.stringify({ event }),
            headers: { 'Content-Type': 'application/json', 'X-Followw-Metrics': '1' },
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            mode: 'same-origin',
            cache: 'no-store',
            signal: controller.signal
        });
    } catch {
        // Métricas não interferem no login e nunca são reenviadas depois.
    } finally {
        clearTimeout(timeout);
        if (typeof window !== 'undefined') window.removeEventListener('storage', revoke);
        pending.delete(controller);
    }
}
