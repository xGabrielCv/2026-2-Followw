import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';

import type { components } from '#/queries/schema.gen';

import { newKey } from '#/lib/author';
import { STORAGE_KEYS, storedValue } from '#/lib/local-storage';
import { initializeLocalVault } from '#/lib/local-vault';
import { api } from '#/queries/api';
import { apiClient } from '#/queries/client';

export type Ticket = components['schemas']['TicketView'];
export type TicketInput = components['schemas']['TicketInput'];

/** O que este navegador sabe de um chamado: a chave é a única prova de posse, e só fica aqui. */
export interface OwnTicket {
    id: string;
    number: number;
    key: string;
    title: string;
    createdAt: string;
    // mensagens já vistas, para destacar as novas
    seen: number;
}

const NO_TICKETS: OwnTicket[] = [];
// sem conta: o suporte funciona deslogado e não depende da sessão do SIGAA
// a chave `support` é tratada como credencial no cofre: não expira com a retenção de 7/30/90 dias
export const ownTickets = storedValue(STORAGE_KEYS.SUPPORT, NO_TICKETS);

export function useOwnTickets(): OwnTicket[] {
    // o cofre pode ficar pronto depois da hidratação: relê quando abrir
    useEffect(() => {
        void initializeLocalVault()
            .then(() => ownTickets.reset())
            .catch(() => ownTickets.reset());
    }, []);
    return useSyncExternalStore(
        ownTickets.subscribe,
        ownTickets.getSnapshot,
        ownTickets.getServerSnapshot
    );
}

export function rememberTicket(ticket: OwnTicket) {
    const rest = ownTickets.getSnapshot().filter((own) => own.id !== ticket.id);
    ownTickets.set([ticket, ...rest]);
}

export function markSeen(id: string, count: number) {
    const tickets = ownTickets.getSnapshot();
    if (tickets.some((own) => own.id === id && own.seen !== count))
        ownTickets.set(
            tickets.map((own) => (own.id === id ? Object.assign({}, own, { seen: count }) : own))
        );
}

export function forgetTicket(id: string) {
    ownTickets.set(ownTickets.getSnapshot().filter((own) => own.id !== id));
}

const header = (key: string) => ({ 'X-Ticket-Key': key });

export const ticketQueryOptions = (id: string, key: string) =>
    api.queryOptions(
        'get',
        '/support/tickets/{ticket_id}',
        { params: { path: { ticket_id: id }, header: header(key) } },
        { staleTime: 0, refetchOnMount: 'always', retry: false, refetchOnWindowFocus: true }
    );

export const useCreateTicket = () => api.useMutation('post', '/support/tickets');

export function useTicketAction(id: string, key: string, action: 'messages' | 'close' | 'reopen') {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (body?: { body: string }) => {
            const params = { path: { ticket_id: id }, header: header(key) };
            const { data, error } =
                action === 'messages' && body
                    ? await apiClient.POST('/support/tickets/{ticket_id}/messages', {
                          params,
                          body
                      })
                    : action === 'close'
                      ? await apiClient.POST('/support/tickets/{ticket_id}/close', { params })
                      : await apiClient.POST('/support/tickets/{ticket_id}/reopen', { params });
            if (error || !data) throw error ?? new Error('Falha ao atualizar o chamado.');
            return data;
        },
        onSuccess: (data) => {
            queryClient.setQueryData(ticketQueryOptions(id, key).queryKey, data);
            markSeen(id, data.message_count);
        }
    });
}

export async function recoverTicketKey(id: string, code: string): Promise<string | null> {
    const { data } = await apiClient.POST('/support/recover', {
        body: { id, code, new_key: newKey() }
    });
    return data?.key ?? null;
}
