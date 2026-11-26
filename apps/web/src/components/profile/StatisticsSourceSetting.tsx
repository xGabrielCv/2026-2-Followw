import { useQueryClient } from '@tanstack/react-query';
import { Check, Database } from 'lucide-react';
import { useState } from 'react';

import { Button } from '#/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '#/components/ui/dialog';
import { cn } from '#/lib/shadcn';
import {
    STATISTICS_SOURCES,
    STATISTICS_SOURCE_DESCRIPTIONS,
    STATISTICS_SOURCE_LABELS,
    type StatisticsSource,
    saveStatisticsSource,
    useStatisticsSource
} from '#/lib/statistics-source';

const STATS_QUERY_PATHS = [
    '/public/subjects/{code}/outcomes',
    '/public/subjects/comparison',
    '/public/courses/indicators',
    '/public/courses/{course_id}/indicators'
] as const;

/** Escolhe em um modal qual base pública usar nos índices agregados de aprovação/reprovação. */
export function StatisticsSourceSetting() {
    const queryClient = useQueryClient();
    const mode = useStatisticsSource();
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<StatisticsSource>(mode);

    const handleOpenChange = (next: boolean) => {
        if (next) setDraft(mode);
        setOpen(next);
    };

    const apply = () => {
        saveStatisticsSource(draft);
        for (const path of STATS_QUERY_PATHS) {
            void queryClient.invalidateQueries({ queryKey: ['get', path] });
        }
        setOpen(false);
    };

    return (
        <>
            <Button
                variant="ghost"
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => handleOpenChange(true)}
                className="-mx-3 h-auto min-h-12 w-[calc(100%+1.5rem)] justify-start gap-3 rounded-none px-3 py-2.5"
            >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Database className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 text-left">
                    <span className="block">Fonte das estatísticas públicas</span>
                    <span className="block truncate text-xs text-muted-foreground">
                        {STATISTICS_SOURCE_LABELS[mode]}
                    </span>
                </span>
            </Button>
            <Dialog open={open} onOpenChange={handleOpenChange}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Fonte das estatísticas públicas</DialogTitle>
                        <DialogDescription>
                            Escolha como o Followw combina as médias públicas das turmas
                            compartilhadas no Followw com o histórico público do Tamburetei UnB /
                            DPO. A troca atualiza as telas de matérias, cursos e estatísticas
                            imediatamente.
                        </DialogDescription>
                    </DialogHeader>
                    <fieldset
                        aria-label="Opções de fonte das estatísticas públicas"
                        className="flex flex-col gap-2 border-0 p-0"
                    >
                        {STATISTICS_SOURCES.map((option) => {
                            const selected = draft === option;
                            return (
                                <button
                                    key={option}
                                    type="button"
                                    aria-pressed={selected}
                                    onClick={() => setDraft(option)}
                                    className={cn(
                                        'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                        selected
                                            ? 'border-primary bg-primary/10'
                                            : 'border-border bg-card hover:bg-muted/60'
                                    )}
                                >
                                    <span
                                        className={cn(
                                            'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                                            selected
                                                ? 'border-primary bg-primary text-primary-foreground'
                                                : 'border-muted-foreground/40'
                                        )}
                                        aria-hidden="true"
                                    >
                                        {selected && <Check className="size-3" />}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-foreground">
                                            {STATISTICS_SOURCE_LABELS[option]}
                                            {option === 'average' && (
                                                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                                    Recomendado
                                                </span>
                                            )}
                                        </span>
                                        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                                            {STATISTICS_SOURCE_DESCRIPTIONS[option]}
                                        </span>
                                    </span>
                                </button>
                            );
                        })}
                    </fieldset>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                            Cancelar
                        </Button>
                        <Button type="button" onClick={apply}>
                            Aplicar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
