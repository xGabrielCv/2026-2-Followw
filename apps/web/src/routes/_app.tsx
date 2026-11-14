import { Outlet, createFileRoute } from '@tanstack/react-router';

import { AppLayout } from '#/components/AppLayout';
import { SemesterAlertPrompt } from '#/components/profile/SemesterAlertPrompt';
import { BackgroundSync } from '#/integrations/prefetch/BackgroundSync';
import { ContentSync } from '#/integrations/prefetch/ContentSync';
import { loadQuery } from '#/queries/load';
import { meQueryOptions } from '#/queries/me';

export const Route = createFileRoute('/_app')({
    loader: async ({ context: { queryClient } }) => {
        await loadQuery(queryClient, meQueryOptions);
    },
    component: () => (
        <AppLayout>
            <Outlet />
            <SemesterAlertPrompt />
            <BackgroundSync />
            <ContentSync />
        </AppLayout>
    )
});
