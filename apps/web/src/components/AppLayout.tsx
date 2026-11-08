import { useLocation, useMatches } from '@tanstack/react-router';
import { createElement } from 'react';

import { BottomNavigation } from '#/components/BottomNavigation';
import { HeaderBar } from '#/components/HeaderBar';
import { OfflineBanner } from '#/components/OfflineBanner';
import { PageStateProvider } from '#/components/PageState';
import { Toaster } from '#/components/ui/toast';
import { cn } from '#/lib/shadcn';

declare module '@tanstack/react-router' {
    interface StaticDataRouteOption {
        // header da página; sem ele, só o logo
        header?: React.FC;
        presentation?: 'fullscreen';
        // no desktop, a página ocupa mais largura para dividir o conteúdo em colunas
        wide?: boolean;
    }
}

interface AppLayoutProps {
    children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
    const header =
        useMatches({ select: (matches) => matches.at(-1)?.staticData.header }) ?? HeaderBar;
    const pathname = useLocation({ select: (location) => location.pathname });
    const wide = useMatches({ select: (matches) => Boolean(matches.at(-1)?.staticData.wide) });

    const fullscreen = useMatches({
        select: (matches) => matches.at(-1)?.staticData.presentation === 'fullscreen'
    });
    if (fullscreen)
        return (
            // no mobile a página rola; no desktop, só o conteúdo
            <div className="flex min-h-dvh flex-col bg-background text-foreground desk:h-dvh desk:overflow-hidden">
                <OfflineBanner />
                <main className="flex flex-1 flex-col desk:min-h-0">{children}</main>
                <Toaster />
            </div>
        );

    return (
        <div className="flex min-h-screen flex-col overflow-x-hidden bg-background text-foreground">
            <div
                className={cn(
                    'mx-auto w-full max-w-2xl px-4 forced-mobile:max-w-md',
                    wide && 'desk:max-w-6xl desk:px-8'
                )}
            >
                <PageStateProvider page={pathname}>
                    {createElement(header)}
                    <OfflineBanner />
                    <main className="flex-1 pb-24">{children}</main>
                </PageStateProvider>
                <BottomNavigation />
                <Toaster />
            </div>
        </div>
    );
};
