import { Link } from '@tanstack/react-router';
import { BellRing } from 'lucide-react';

import type { CalendarEntry } from '#/queries/events';

import { ListCard } from '#/components/ListCard';
import { SectionHeader } from '#/components/SectionHeader';
import { ENTRY_KINDS, daysUntil, dueReminders, formatClock, relativeDays } from '#/lib/agenda';
import { cn } from '#/lib/shadcn';

/** Provas, trabalhos e eventos cujo lembrete já começou; some quando não há nenhum. */
export function RemindersSection({ entries, today }: { entries: CalendarEntry[]; today: string }) {
    const due = dueReminders(entries, today);
    if (due.length === 0) return null;
    return (
        <section aria-label="Lembretes">
            <SectionHeader title="Lembretes" actionLabel="Calendário" actionTo="/calendario" />
            <ListCard>
                {due.map((entry) => {
                    const kind = ENTRY_KINDS[entry.kind ?? 'evento'];
                    const days = daysUntil(today, entry.date);
                    return (
                        <Link
                            key={entry.id}
                            to="/calendario"
                            search={{ date: entry.date }}
                            className="flex items-center gap-3 py-2.5 hover:opacity-80"
                        >
                            <span
                                className={cn(
                                    'flex size-8 shrink-0 items-center justify-center rounded-lg',
                                    kind.soft,
                                    kind.text
                                )}
                            >
                                <BellRing className="size-4" aria-hidden="true" />
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span className="truncate text-sm font-medium">{entry.title}</span>
                                <span className="text-xs text-muted-foreground">
                                    {[
                                        kind.label,
                                        entry.subject_code,
                                        entry.time && formatClock(entry.time)
                                    ]
                                        .filter(Boolean)
                                        .join(' · ')}
                                </span>
                            </span>
                            <span
                                className={cn(
                                    'shrink-0 text-xs font-semibold',
                                    days <= 1 ? 'text-destructive' : 'text-primary'
                                )}
                            >
                                {relativeDays(days)}
                            </span>
                        </Link>
                    );
                })}
            </ListCard>
        </section>
    );
}
