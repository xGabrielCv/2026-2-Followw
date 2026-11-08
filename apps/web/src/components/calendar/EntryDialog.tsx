import { useState } from 'react';

import type { CalendarEntry, CalendarEntryInput, CalendarEntryKind } from '#/queries/events';

import { TabFilter } from '#/components/TabFilter';
import { Button } from '#/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '#/components/ui/dialog';
import { Input } from '#/components/ui/input';
import { Label } from '#/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '#/components/ui/select';
import { Textarea } from '#/components/ui/textarea';
import { ENTRY_KINDS, ENTRY_KIND_ORDER, REMINDER_OPTIONS, dayLabel } from '#/lib/agenda';
import { useDeleteCalendarEntry, useSaveCalendarEntry } from '#/queries/events';

export interface SubjectOption {
    code: string;
    name: string;
}

interface EntryDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    date: string;
    // sem ele, cria um lançamento novo
    entry?: CalendarEntry;
    subjects: SubjectOption[];
}

const NONE = '-';

function initial(date: string, entry?: CalendarEntry): CalendarEntryInput {
    return entry
        ? { ...entry, time: entry.time?.slice(0, 5) ?? null }
        : {
              date,
              title: '',
              kind: 'prova',
              subject_code: null,
              time: null,
              notes: null,
              remind_days: 1
          };
}

/** Lança ou edita uma prova, trabalho, evento ou lembrete, com aviso antes da data. */
export function EntryDialog({ open, onOpenChange, date, entry, subjects }: EntryDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                {/* remonta a cada abertura para começar com os valores do dia ou do lançamento */}
                {open && (
                    <EntryForm
                        date={date}
                        entry={entry}
                        subjects={subjects}
                        onDone={() => onOpenChange(false)}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}

function EntryForm({
    date,
    entry,
    subjects,
    onDone
}: {
    date: string;
    entry?: CalendarEntry;
    subjects: SubjectOption[];
    onDone: () => void;
}) {
    const [form, setForm] = useState(() => initial(date, entry));
    const save = useSaveCalendarEntry();
    const remove = useDeleteCalendarEntry();
    const pending = save.isPending || remove.isPending;
    const valid = form.title.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(form.date);
    const update = (change: Partial<CalendarEntryInput>) =>
        setForm((current) => ({ ...current, ...change }));

    const submit = async () => {
        try {
            await save.mutateAsync({
                id: entry?.id,
                body: { ...form, title: form.title.trim(), notes: form.notes?.trim() || null }
            });
            onDone();
        } catch {
            // a mensagem de erro fica no formulário para tentar de novo
        }
    };
    const destroy = async () => {
        if (!entry) return;
        try {
            await remove.mutateAsync(entry.id);
            onDone();
        } catch {
            // idem
        }
    };

    const subjectItems = [
        { value: NONE, label: 'Nenhuma' },
        ...subjects.map((subject) => ({
            value: subject.code,
            label: `${subject.code} · ${subject.name}`
        }))
    ];
    const reminderItems = REMINDER_OPTIONS.map((option) => ({
        value: String(option.value),
        label: option.label
    }));

    return (
        <>
            <DialogHeader>
                <DialogTitle>{entry ? 'Editar lançamento' : 'Novo lançamento'}</DialogTitle>
                <DialogDescription className="first-letter:uppercase">
                    {dayLabel(form.date)}
                </DialogDescription>
            </DialogHeader>
            <form
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                    event.preventDefault();
                    if (valid && !pending) void submit();
                }}
            >
                <TabFilter<CalendarEntryKind>
                    label="Tipo"
                    value={form.kind ?? 'evento'}
                    options={ENTRY_KIND_ORDER}
                    labels={Object.fromEntries(
                        ENTRY_KIND_ORDER.map((kind) => [kind, ENTRY_KINDS[kind].label])
                    )}
                    onChange={(kind) => update({ kind })}
                />
                <div className="flex flex-col gap-2">
                    <Label htmlFor="entry-title">Título</Label>
                    <Input
                        id="entry-title"
                        value={form.title}
                        maxLength={120}
                        placeholder="Ex.: Prova 2"
                        onChange={(event) => update({ title: event.target.value })}
                    />
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="entry-date">Data</Label>
                        <Input
                            id="entry-date"
                            type="date"
                            value={form.date}
                            onChange={(event) => update({ date: event.target.value })}
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="entry-time">Horário</Label>
                        <Input
                            id="entry-time"
                            type="time"
                            value={form.time ?? ''}
                            onChange={(event) => update({ time: event.target.value || null })}
                        />
                    </div>
                </div>
                <div className="flex flex-col gap-2">
                    <Label htmlFor="entry-subject">Matéria</Label>
                    <Select
                        items={subjectItems}
                        value={form.subject_code ?? NONE}
                        onValueChange={(value) =>
                            update({ subject_code: value && value !== NONE ? value : null })
                        }
                    >
                        <SelectTrigger id="entry-subject" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {subjectItems.map((item) => (
                                <SelectItem key={item.value} value={item.value}>
                                    {item.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex flex-col gap-2">
                    <Label htmlFor="entry-reminder">Lembrar</Label>
                    <Select
                        items={reminderItems}
                        value={String(form.remind_days ?? null)}
                        onValueChange={(value) =>
                            update({
                                remind_days:
                                    value === 'null' || value == null ? null : Number(value)
                            })
                        }
                    >
                        <SelectTrigger id="entry-reminder" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {reminderItems.map((item) => (
                                <SelectItem key={item.value} value={item.value}>
                                    {item.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        O lembrete aparece no início e no calendário a partir do dia escolhido.
                    </p>
                </div>
                <div className="flex flex-col gap-2">
                    <Label htmlFor="entry-notes">Observações</Label>
                    <Textarea
                        id="entry-notes"
                        value={form.notes ?? ''}
                        maxLength={1000}
                        placeholder="Conteúdo, sala, o que levar..."
                        onChange={(event) => update({ notes: event.target.value })}
                    />
                </div>
                {(save.isError || remove.isError) && (
                    <p role="alert" className="text-xs text-destructive">
                        Não foi possível salvar. Verifique a conexão e tente novamente.
                    </p>
                )}
                <DialogFooter>
                    {entry && (
                        <Button
                            type="button"
                            variant="outline"
                            className="text-destructive"
                            disabled={pending}
                            onClick={() => void destroy()}
                        >
                            Apagar
                        </Button>
                    )}
                    <Button type="submit" disabled={!valid || pending}>
                        {save.isPending ? 'Salvando...' : 'Salvar'}
                    </Button>
                </DialogFooter>
            </form>
        </>
    );
}
