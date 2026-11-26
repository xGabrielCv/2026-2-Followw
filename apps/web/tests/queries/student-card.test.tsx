import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { localStorageRepository, selectLocalAccount, STORAGE_KEYS } from '#/lib/local-storage';
import { credentialsQueryOptions } from '#/queries/restaurant-account';
import { useStudentCard } from '#/queries/student-card';

import { useDom } from '../helpers/dom';

function CardProbe({ registration }: { registration: string }) {
    const query = useStudentCard(registration);
    return (
        <output>{query.data ? `${query.data.token}|${query.data.valid_until}` : 'vazio'}</output>
    );
}

describe('useStudentCard', () => {
    const dom = useDom();

    beforeEach(() => {
        selectLocalAccount('251000000');
        localStorageRepository.clear();
    });

    afterEach(() => {
        selectLocalAccount(undefined);
    });

    test('salva a carteirinha válida cifrada no cofre e restaura offline sem nova consulta', async () => {
        const firstClient = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        });
        const card = { token: 'QR-VALIDO-2099', valid_until: '2099-12-31' };
        firstClient.setQueryData(credentialsQueryOptions('251000000').queryKey, card, {
            updatedAt: Date.now()
        });

        const firstView = dom.testing.render(
            <QueryClientProvider client={firstClient}>
                <CardProbe registration="251000000" />
            </QueryClientProvider>
        );
        await dom.testing.waitFor(() => {
            expect(firstView.getByRole('status').textContent).toBe('QR-VALIDO-2099|2099-12-31');
        });
        firstView.unmount();

        // Novo QueryClient vazio simula reabertura offline: restaura direto do cofre cifrado.
        const secondClient = new QueryClient({
            defaultOptions: { queries: { retry: false, enabled: false } }
        });
        const secondView = dom.testing.render(
            <QueryClientProvider client={secondClient}>
                <CardProbe registration="251000000" />
            </QueryClientProvider>
        );
        expect(secondView.getByRole('status').textContent).toBe('QR-VALIDO-2099|2099-12-31');
        secondView.unmount();

        // Conta diferente não lê a carteirinha salva da primeira conta.
        selectLocalAccount('252000000');
        const otherView = dom.testing.render(
            <QueryClientProvider client={new QueryClient()}>
                <CardProbe registration="252000000" />
            </QueryClientProvider>
        );
        expect(otherView.getByRole('status').textContent).toBe('vazio');
    });

    test('não restaura carteirinha vencida salva no cofre', () => {
        localStorageRepository.set(STORAGE_KEYS.STUDENT_CARD, {
            registration: '251000000',
            credentials: { token: 'QR-ANTIGO', valid_until: '2020-01-01' },
            updatedAt: Date.now()
        });

        const client = new QueryClient({
            defaultOptions: { queries: { retry: false, enabled: false } }
        });
        const view = dom.testing.render(
            <QueryClientProvider client={client}>
                <CardProbe registration="251000000" />
            </QueryClientProvider>
        );
        expect(view.getByRole('status').textContent).toBe('vazio');
    });
});
