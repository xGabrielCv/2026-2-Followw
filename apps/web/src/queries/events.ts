import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

import { validDate } from '#/lib/date';
import { accountStore } from '#/lib/local-storage';
import { meQueryOptions } from '#/queries/me';

// Lançamentos do calendário são do aluno: ficam só no navegador, nunca no servidor.
export type CalendarEntryKind = 'prova' | 'trabalho' | 'evento' | 'lembrete';

export interface CalendarEntryInput {
    date: string;
    // HH:MM, horário de Brasília
    time: string | null;
    title: string;
    kind: CalendarEntryKind;
    subject_code: string | null;
    notes: string | null;
    // dias de antecedência do lembrete; nulo não lembra
    remind_days: number | null;
}

export interface CalendarEntry extends CalendarEntryInput {
    id: string;
}

const EMPTY: CalendarEntry[] = [];
export const MAX_ENTRIES = 500;

export const entriesStore = (registration: string) =>
    accountStore<CalendarEntry[]>(`events:${registration}`, EMPTY);

/** Confere o lançamento como a API conferia: título, data, tipo e lembrete válidos. */
export function validEntry(entry: CalendarEntryInput): boolean {
    const title = entry.title.trim();
    return (
        title.length > 0 &&
        title.length <= 120 &&
        validDate(entry.date) &&
        (entry.time == null || /^([01]\d|2[0-3]):[0-5]\d$/.test(entry.time)) &&
        ['prova', 'trabalho', 'evento', 'lembrete'].includes(entry.kind) &&
        (entry.remind_days == null || (entry.remind_days >= 0 && entry.remind_days <= 30)) &&
        (entry.notes?.length ?? 0) <= 1000
    );
}

const byDate = (a: CalendarEntry, b: CalendarEntry) =>
    a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '');

function useStore() {
    const { data: user } = useSuspenseQuery(meQueryOptions);
    return user ? entriesStore(user.registration) : null;
}

export function useCalendarEntries() {
    const store = useStore();
    const data = useSyncExternalStore(
        store?.subscribe ?? noopSubscribe,
        store?.getSnapshot ?? emptySnapshot,
        () => EMPTY
    );
    return { data };
}

const noopSubscribe = () => () => {};
const emptySnapshot = () => EMPTY;

type SaveEntry = { id?: string; body: CalendarEntryInput };

/** Cria (sem `id`) ou edita um lançamento no navegador. */
export function useSaveCalendarEntry() {
    const store = useStore();
    return useMutation({
        mutationFn: async ({ id, body }: SaveEntry) => {
            if (!store) throw new Error('Entre na conta para lançar no calendário');
            const entry = { ...body, title: body.title.trim() };
            if (!validEntry(entry)) throw new Error('Lançamento inválido');
            const current = store.getSnapshot();
            if (!id && current.length >= MAX_ENTRIES) throw new Error('Calendário cheio');
            const next = id
                ? current.map((item) => (item.id === id ? { ...entry, id } : item))
                : [...current, { ...entry, id: crypto.randomUUID() }];
            store.set(next.toSorted(byDate));
        }
    });
}

export function useDeleteCalendarEntry() {
    const store = useStore();
    return useMutation({
        mutationFn: async (id: string) => {
            if (!store) return;
            store.set(store.getSnapshot().filter((item) => item.id !== id));
        }
    });
}
