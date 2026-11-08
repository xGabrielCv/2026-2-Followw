import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, spyOn, test } from 'bun:test';

import type { components } from '#/queries/schema.gen';

import { ShareStatisticsSetting } from '#/components/profile/ShareStatisticsSetting';
import { apiClient } from '#/queries/client';
import { meQueryOptions } from '#/queries/me';
import { settingsStore } from '#/queries/settings';

import { useDom } from '../../helpers/dom';

const dom = useDom();
afterEach(() => dom.testing.cleanup());

const user: components['schemas']['UserProfile'] = {
    name: 'Nome Discente',
    registration: '202600001',
    photo: null,
    bio: null,
    unit: null,
    course: null,
    entry_semester: null,
    integralization: null,
    workload: null,
    period_max_workload: null,
    ira: null,
    mp: null,
    level: 'Graduação'
};

function render(shareStatistics: boolean) {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    client.setQueryData(meQueryOptions.queryKey, user);
    settingsStore(user.registration).set({ shareStatistics });
    return dom.testing.render(
        <QueryClientProvider client={client}>
            <ShareStatisticsSetting />
        </QueryClientProvider>
    );
}

test('ativar pede confirmação antes de compartilhar', () => {
    const patch = spyOn(apiClient, 'PUT');
    try {
        const page = render(false);
        const toggle = page.getByRole('button', { name: 'Compartilhar índices das minhas turmas' });
        expect(toggle.getAttribute('aria-pressed')).toBe('false');
        dom.testing.fireEvent.click(toggle);
        // só o aviso abre: nada vai para a API sem o aluno confirmar
        expect(patch).not.toHaveBeenCalled();
    } finally {
        patch.mockRestore();
    }
});

test('desativar vale na hora', async () => {
    const fake = {
        data: { shared: false, classrooms: 0, pending: false },
        error: undefined,
        response: new Response()
    };
    const patch = spyOn(apiClient, 'PUT').mockResolvedValue(fake);
    try {
        const page = render(true);
        const toggle = page.getByRole('button', { name: 'Compartilhar índices das minhas turmas' });
        expect(toggle.getAttribute('aria-pressed')).toBe('true');
        dom.testing.fireEvent.click(toggle);
        await dom.testing.waitFor(() => expect(patch).toHaveBeenCalled());
        expect(patch.mock.calls[0]?.[0] as unknown).toBe('/me/statistics-sharing');
        expect(patch.mock.calls[0]?.[1]).toMatchObject({ body: { shared: false } });
        await dom.testing.waitFor(() =>
            expect(settingsStore(user.registration).getSnapshot().shareStatistics).toBe(false)
        );
    } finally {
        patch.mockRestore();
    }
});
