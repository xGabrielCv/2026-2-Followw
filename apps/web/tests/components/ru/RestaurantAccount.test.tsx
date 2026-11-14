import * as baseUILayout from '@base-ui/utils/useIsoLayoutEffect';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { useLayoutEffect } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { credentialsQueryOptions, statementQueryOptions } from '#/queries/restaurant-account';

import { useDom } from '../../helpers/dom';

const dom = useDom();
let RestaurantAccount: typeof import('#/components/ru/RestaurantAccount').RestaurantAccount;
let StatementDetails: typeof import('#/components/ru/RestaurantAccount').StatementDetails;
let StudentCard: typeof import('#/components/ru/RestaurantAccount').StudentCard;
let restoreLayoutEffect: () => Promise<void>;
beforeAll(async () => {
    // A importação SSR anterior ao DOM deixa este hook vazio no cache do Bun.
    const previous = baseUILayout.useIsoLayoutEffect;
    await mock.module('@base-ui/utils/useIsoLayoutEffect', () => ({
        useIsoLayoutEffect: useLayoutEffect
    }));
    restoreLayoutEffect = async () => {
        await mock.module('@base-ui/utils/useIsoLayoutEffect', () => ({
            useIsoLayoutEffect: previous
        }));
    };
    ({ RestaurantAccount, StatementDetails, StudentCard } =
        await import('#/components/ru/RestaurantAccount'));
});
afterAll(() => restoreLayoutEffect());

describe('RestaurantAccount', () => {
    test('consome uma vez o pedido com credenciais atrasadas e não reabre ao chegar o saldo', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
        const registration = '202600001';
        const consumed = mock(() => {});
        const account = (openCard = true) => (
            <QueryClientProvider client={client}>
                <RestaurantAccount
                    registration={registration}
                    openCard={openCard}
                    onCardConsumed={consumed}
                />
            </QueryClientProvider>
        );
        const { render, act, waitFor, fireEvent } = dom.testing;
        const view = render(account());
        const trigger = () => view.getByLabelText('Ver QR code da carteirinha');
        await waitFor(() => expect(trigger().getAttribute('aria-expanded')).toBe('true'));
        expect(consumed).toHaveBeenCalledTimes(1);
        expect(view.getByText('Carregando carteirinha...')).toBeDefined();

        view.rerender(account(false));
        await act(async () => {
            client.setQueryData(statementQueryOptions(registration).queryKey, {
                balance: '12.50',
                group: 2,
                entries: []
            });
        });
        await waitFor(() => {
            expect(view.getByText('Saldo disponível')).toBeDefined();
            expect(trigger().getAttribute('aria-expanded')).toBe('true');
        });
        fireEvent.click(view.getByText('Fechar'));
        await waitFor(() => expect(trigger().getAttribute('aria-expanded')).toBe('false'));
        await act(async () => {
            client.setQueryData(credentialsQueryOptions(registration).queryKey, {
                token: 'carteirinha-token',
                valid_until: '2099-10-01'
            });
        });
        view.rerender(account(false));
        expect(trigger().getAttribute('aria-expanded')).toBe('false');
        expect(consumed).toHaveBeenCalledTimes(1);
        view.unmount();
        client.clear();
    });

    test('fechar não repete um pedido ainda presente no histórico', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
        const consumed = mock(() => {});
        const { render, waitFor, fireEvent } = dom.testing;
        const view = render(
            <QueryClientProvider client={client}>
                <RestaurantAccount registration="202600001" openCard onCardConsumed={consumed} />
            </QueryClientProvider>
        );
        const trigger = () => view.getByLabelText('Ver QR code da carteirinha');
        await waitFor(() => expect(trigger().getAttribute('aria-expanded')).toBe('true'));
        fireEvent.click(view.getByText('Fechar'));
        await waitFor(() => expect(trigger().getAttribute('aria-expanded')).toBe('false'));
        expect(consumed).toHaveBeenCalledTimes(1);
        view.unmount();
        client.clear();
    });

    test('oferece botão para abrir o QR code em um drawer sem exibi-lo na página', () => {
        const queryClient = new QueryClient();
        const registration = '202600001';
        queryClient.setQueryData(credentialsQueryOptions(registration).queryKey, {
            token: 'carteirinha-token',
            valid_until: '2026-10-01'
        });

        const markup = renderToStaticMarkup(
            <QueryClientProvider client={queryClient}>
                <RestaurantAccount registration={registration} />
            </QueryClientProvider>
        );

        expect(markup).toMatch(
            /<button\b(?=[^>]*aria-haspopup="dialog")(?=[^>]*aria-label="Ver QR code da carteirinha")[^>]*>/
        );
        expect(markup).toContain('aria-expanded="false"');
        expect(markup).not.toContain('QR code da carteirinha estudantil');
        expect(markup).not.toContain('carteirinha-token');
    });

    test('esconde o rótulo do saldo enquanto o extrato carrega', () => {
        const markup = renderToStaticMarkup(
            <QueryClientProvider client={new QueryClient()}>
                <RestaurantAccount registration="202600001" />
            </QueryClientProvider>
        );
        expect(markup).toContain('Carregando saldo e extrato');
        expect(markup).not.toContain('Saldo disponível');
    });
});

describe('StatementDetails', () => {
    test('deixa o saldo em vermelho quando não paga a refeição atual ou próxima', () => {
        const markup = renderToStaticMarkup(
            <StatementDetails
                now={{ date: '2026-10-05', weekday: 1, time: '09:30' }}
                statement={{ balance: '4.49', group: 2, entries: [] }}
            />
        );
        expect(markup).toContain('text-destructive');
    });

    test('usa os preços do Grupo 4 para o saldo insuficiente', () => {
        const markup = renderToStaticMarkup(
            <StatementDetails
                now={{ date: '2026-10-05', weekday: 1, time: '08:00' }}
                statement={{ balance: '1.00', group: 4, entries: [] }}
            />
        );
        expect(markup).toContain('text-destructive');
    });

    test.each([
        { balance: '-1.00', group: 1 },
        { balance: '4.50', group: 2 },
        { balance: '2.50', group: 4 },
        { balance: '0.00', group: null }
    ] as const)(
        'não destaca o saldo com isenção, saldo suficiente ou dados ausentes: %j',
        (account) => {
            const markup = renderToStaticMarkup(
                <StatementDetails
                    now={{ date: '2026-10-05', weekday: 1, time: '12:00' }}
                    statement={{ ...account, entries: [] }}
                />
            );
            expect(markup).not.toContain('text-destructive');
        }
    );

    test.each([
        ['Grupo 1 Almoço', 'Almoço'],
        ['Grupo2 Jantar', 'Jantar'],
        ['GRUPO 3 Café da manhã', 'Café da manhã'],
        ['Recarga', 'Recarga']
    ])('exibe apenas a refeição em %s', (description, label) => {
        const markup = renderToStaticMarkup(
            <StatementDetails
                statement={{
                    balance: '10.00',
                    group: 2,
                    entries: [
                        {
                            occurred_at: '2026-10-05T12:00:00-03:00',
                            description,
                            amount: '-5.20'
                        }
                    ]
                }}
            />
        );
        expect(markup).toContain(`>${label}</p>`);
    });

    test('mostra saldo zero e extrato por dia com débitos, créditos e saldo após cada um', () => {
        const markup = renderToStaticMarkup(
            <StatementDetails
                statement={{
                    balance: '0.00',
                    group: 2,
                    entries: [
                        {
                            occurred_at: '2026-10-05T12:00:00-03:00',
                            description: 'Almoço',
                            amount: '-5.20'
                        },
                        {
                            occurred_at: '2026-10-05T09:00:00-03:00',
                            description: 'Recarga',
                            amount: '20.00'
                        }
                    ]
                }}
            />
        );
        expect(markup).toContain('0,00');
        expect(markup).toContain('Almoço');
        expect(markup).toContain('-R$');
        expect(markup).toContain('5,20');
        expect(markup).toContain('20,00');
        expect(markup).toContain('seg., 05/10');
        expect(markup).toContain('12:00');
        // saldo reconstruído: antes do almoço havia R$ 5,20
        expect(markup).toMatch(/saldo R\$\s5,20/);
        expect(markup).toContain('Refeições');
        expect(markup).toMatch(/text-destructive[^>]*>-R\$\s5,20/);
        expect(markup).toMatch(/text-success[^>]*>R\$\s20,00/);
    });

    test('mostra saldo zerado sem grupo e extrato vazio', () => {
        const markup = renderToStaticMarkup(
            <StatementDetails statement={{ balance: '0.00', group: null, entries: [] }} />
        );
        expect(markup).toMatch(/R\$\s0,00/);
        expect(markup).toContain('Nenhuma movimentação');
    });
});

describe('StudentCard', () => {
    const credentials = { token: 'carteirinha-token', valid_until: '2026-10-01' };

    test('gera QR code local em SVG durante todo o mês de validade', () => {
        const markup = renderToStaticMarkup(
            <StudentCard credentials={credentials} date="2026-10-31" />
        );
        expect(markup).toContain('<svg');
        expect(markup).toContain('QR code da carteirinha estudantil');
        expect(markup).toContain('outubro de 2026');
        expect(markup).not.toContain('<img');
    });

    test('mostra aviso no lugar de QR code vencido', () => {
        const markup = renderToStaticMarkup(
            <StudentCard credentials={credentials} date="2026-11-01" />
        );
        expect(markup).toContain('Carteirinha vencida');
        expect(markup).not.toContain('<svg');
    });
});
