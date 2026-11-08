import { Check, RotateCcw } from 'lucide-react';

import { SUBJECT_COLORS } from '#/lib/agenda';
import { useOnline } from '#/lib/online';
import { cn } from '#/lib/shadcn';
import { useSubjectColors } from '#/queries/settings';

/** Troca a cor da matéria na agenda do dia e no calendário; salva na conta. */
export function SubjectColorPicker({ code, automatic }: { code: string; automatic: number }) {
    const { chosen, setColor, pending, failed } = useSubjectColors();
    const online = useOnline();
    const current = chosen[code] ?? automatic;
    const disabled = !online || pending;

    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 rounded-xl bg-card px-3 py-1.5">
                <span className="shrink-0 text-xs font-medium text-muted-foreground">
                    Cor na agenda
                </span>
                <fieldset
                    className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
                    aria-label="Cor da matéria"
                >
                    {SUBJECT_COLORS.map((color, index) => (
                        <button
                            key={color.solid}
                            type="button"
                            aria-pressed={index === current}
                            aria-label={`Cor ${index + 1}`}
                            disabled={disabled}
                            onClick={() => setColor(code, index)}
                            className={cn(
                                'flex size-5 items-center justify-center rounded-full transition-transform outline-none hover:scale-110 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50',
                                color.solid,
                                index === current &&
                                    'ring-2 ring-foreground ring-offset-1 ring-offset-card'
                            )}
                        >
                            {index === current && (
                                <Check className="size-3 text-background" aria-hidden="true" />
                            )}
                        </button>
                    ))}
                </fieldset>
                {chosen[code] != null && (
                    <button
                        type="button"
                        className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-primary disabled:opacity-50"
                        aria-label="Voltar à cor automática"
                        title="Voltar à cor automática"
                        disabled={disabled}
                        onClick={() => setColor(code, null)}
                    >
                        <RotateCcw className="size-3.5" aria-hidden="true" />
                    </button>
                )}
            </div>
            {failed && (
                <p role="alert" className="px-1 text-xs text-destructive">
                    Não foi possível salvar a cor. Tente novamente.
                </p>
            )}
        </div>
    );
}
