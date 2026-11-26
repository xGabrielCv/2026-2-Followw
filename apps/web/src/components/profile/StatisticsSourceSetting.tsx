import { Database } from 'lucide-react';

import { cn } from '#/lib/shadcn';
import {
    STATISTICS_SOURCES,
    STATISTICS_SOURCE_DESCRIPTIONS,
    STATISTICS_SOURCE_LABELS,
    saveStatisticsSource,
    useStatisticsSource
} from '#/lib/statistics-source';

/** Escolhe qual base pública usar nos índices agregados de aprovação/reprovação. */
export function StatisticsSourceSetting() {
    const mode = useStatisticsSource();

    return (
        <div className="flex flex-col gap-2 py-2.5">
            <div className="flex items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Database className="size-4" aria-hidden="true" />
                </span>
                <div className="flex min-w-0 flex-col">
                    <span className="text-sm font-medium">Fonte das estatísticas públicas</span>
                    <span className="text-xs text-muted-foreground">
                        {STATISTICS_SOURCE_DESCRIPTIONS[mode]}
                    </span>
                </div>
            </div>
            <fieldset
                aria-label="Fonte das estatísticas públicas"
                className="grid grid-cols-2 gap-1.5 border-0 p-0"
            >
                {STATISTICS_SOURCES.map((option) => {
                    const active = mode === option;
                    return (
                        <button
                            key={option}
                            type="button"
                            aria-pressed={active}
                            onClick={() => saveStatisticsSource(option)}
                            className={cn(
                                'rounded-lg border px-2.5 py-2 text-left text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                active
                                    ? 'border-primary bg-primary/10 text-primary'
                                    : 'border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                            )}
                        >
                            {STATISTICS_SOURCE_LABELS[option]}
                        </button>
                    );
                })}
            </fieldset>
        </div>
    );
}
