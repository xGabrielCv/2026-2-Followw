import { useHydrated } from '@tanstack/react-router';
import { Info, TriangleAlert, X } from 'lucide-react';
import { useCallback, useSyncExternalStore } from 'react';

import { longTimer } from '#/lib/query-timers';
import { cn } from '#/lib/shadcn';
import { useAppConfig } from '#/queries/app-config';

const DISMISSED_KEY = 'followw:dismissed-banner';
const listeners = new Set<() => void>();
let fallbackDismissed: string | null = null;

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function snapshot(): string | null {
    if (typeof window === 'undefined') return null;
    try {
        return window.sessionStorage.getItem(DISMISSED_KEY);
    } catch {
        return fallbackDismissed;
    }
}

export const SystemNoticeBanner: React.FC = () => {
    const { banner } = useAppConfig();
    const dismissedId = useSyncExternalStore(subscribe, snapshot, () => null);
    const hydrated = useHydrated();
    const expiresAt = Date.parse(banner?.expires_at ?? '');
    const subscribeExpiry = useCallback(
        (notify: () => void) => {
            if (!Number.isFinite(expiresAt)) return () => {};
            const timer = longTimer(notify, expiresAt - Date.now());
            return () => timer.cancel();
        },
        [expiresAt]
    );
    const expired = useSyncExternalStore(
        subscribeExpiry,
        () => expiresAt <= Date.now(),
        () => false
    );

    if (!hydrated || !banner || expired || dismissedId === banner.id) return null;

    const warning = banner.level === 'warning';
    const Icon = warning ? TriangleAlert : Info;

    const dismiss = () => {
        try {
            window.sessionStorage.setItem(DISMISSED_KEY, banner.id);
        } catch {
            fallbackDismissed = banner.id;
        }
        for (const listener of listeners) listener();
    };

    return (
        <aside
            aria-label="Aviso operacional"
            className={cn(
                'mb-4 flex min-w-0 items-start gap-2.5 rounded-xl border px-3 py-2.5 text-xs',
                warning
                    ? 'border-warning/30 bg-warning/10 text-foreground'
                    : 'border-primary/25 bg-primary/10 text-foreground'
            )}
        >
            <Icon
                className={cn('mt-0.5 size-4 shrink-0', warning ? 'text-warning' : 'text-primary')}
                aria-hidden="true"
            />
            <div className="min-w-0 flex-1 wrap-anywhere">
                <p className="font-semibold">{banner.title}</p>
                <p className="mt-0.5 text-muted-foreground">{banner.message}</p>
            </div>
            <button
                type="button"
                onClick={dismiss}
                aria-label="Dispensar aviso"
                className="-m-1 shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
                <X className="size-4" aria-hidden="true" />
            </button>
        </aside>
    );
};
