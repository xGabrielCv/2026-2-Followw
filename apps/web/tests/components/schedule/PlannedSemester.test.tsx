import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
    createMemoryHistory,
    createRootRoute,
    createRouter,
    RouterProvider
} from '@tanstack/react-router';
import { afterEach, expect, test } from 'bun:test';

import type { PlannedClass } from '#/lib/planned-schedule';

import { PlannedSemester } from '#/components/schedule/PlannedSemester';
import { plannedSchedule } from '#/lib/planned-schedule';
import { parseRouterSearch, stringifyRouterSearch } from '#/lib/search-params';
import { meQueryOptions } from '#/queries/me';
import { offerSemestersQueryOptions } from '#/queries/subjects';

import { useDom } from '../../helpers/dom';

const dom = useDom();
afterEach(() => {
    dom.testing.cleanup();
    plannedSchedule.clear();
});

const planned = (code: string, semester: string, schedule: string): PlannedClass => ({
    code,
    name: `MATÉRIA ${code}`,
    hours: 60,
    number: '01',
    semester,
    schedule,
    room: 'S1',
    professors: [{ name: 'Ana Souza', siape: null, photo: null, email: null }]
});

async function render(offer: string[]) {
    const client = new QueryClient();
    client.setQueryData(meQueryOptions.queryKey, null);
    client.setQueryData(offerSemestersQueryOptions.queryKey, offer);
    const root = createRootRoute({ component: () => <PlannedSemester semester="2027.1" /> });
    const router = createRouter({
        routeTree: root,
        history: createMemoryHistory(),
        parseSearch: parseRouterSearch,
        stringifySearch: stringifyRouterSearch
    });
    await router.load();
    return dom.testing.render(
        <QueryClientProvider client={client}>
            <RouterProvider router={router} />
        </QueryClientProvider>
    );
}

test('mostra a grade planejada do semestre futuro, a mesma da busca, e permite tirar turmas', async () => {
    plannedSchedule.set([
        planned('FGA0304', '2027.1', '24M12'),
        planned('FGA0315', '2027.1', '35T23'),
        planned('FGA0030', '2026.2', '26M12')
    ]);
    const page = await render(['2027.1', '2026.2']);

    expect(await page.findByRole('region', { name: 'Grade semanal 2027.1' })).toBeDefined();
    expect(page.container.textContent).toContain('MATÉRIA FGA0304');
    expect(page.container.textContent).not.toContain('MATÉRIA FGA0030');
    expect(
        page.getByRole('link', { name: /Escolher turmas de 2027.1/ }).getAttribute('href')
    ).toContain('semester=2027.1');

    dom.testing.fireEvent.click(
        page.getByRole('button', { name: 'Remover da grade: FGA0304, turma 01' })
    );
    // a mesma lista da busca: sai de lá também
    expect(plannedSchedule.getSnapshot().map((item) => item.code)).toEqual(['FGA0315', 'FGA0030']);
});

test('antes da oferta sair, avisa e não oferece escolher turmas', async () => {
    const page = await render(['2026.2']);
    expect(await page.findByText(/ainda não foi publicada no SIGAA/)).toBeDefined();
    expect(page.queryByRole('link', { name: /Escolher turmas/ })).toBeNull();
    expect(page.container.textContent).toContain('Nenhuma turma de 2027.1 na sua grade ainda.');
});
