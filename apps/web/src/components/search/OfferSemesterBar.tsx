import type { OfferChoice } from '#/lib/offer';

import { Button } from '#/components/ui/button';
import { enrollmentStart } from '#/lib/offer';

const fullDate = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' });
const KIND_LABELS = { current: 'atual', next: 'próximo' };

interface OfferSemesterBarProps {
    choices: OfferChoice[];
    selected?: string;
    onChange: (semester: string) => void;
}

/** Deixa claro de qual semestre são as turmas e libera o próximo quando a oferta sai. */
export function OfferSemesterBar({ choices, selected, onChange }: OfferSemesterBarProps) {
    if (!choices.length) return null;
    const next = choices.find((choice) => choice.kind === 'next');
    const start = next && !next.available && enrollmentStart(next.semester);
    const planning = next?.available && selected === next.semester;

    return (
        <div className="-my-2 flex flex-col gap-1">
            <fieldset
                aria-label="Semestre da oferta"
                className="flex items-center gap-1 overflow-x-auto py-1 max-md:no-scrollbar"
            >
                <span className="shrink-0 px-1 text-xs font-medium text-muted-foreground">
                    Turmas de
                </span>
                {choices.map((choice) => (
                    <Button
                        key={choice.semester}
                        size="sm"
                        variant={choice.semester === selected ? 'secondary' : 'ghost'}
                        aria-pressed={choice.semester === selected}
                        disabled={!choice.available}
                        onClick={() => onChange(choice.semester)}
                        className="shrink-0"
                    >
                        <span className="font-semibold tabular-nums">{choice.semester}</span>
                        <span className="text-muted-foreground">
                            {choice.available ? KIND_LABELS[choice.kind] : 'em breve'}
                        </span>
                    </Button>
                ))}
            </fieldset>
            {next && !next.available && (
                <p className="px-1 text-xs text-muted-foreground">
                    A oferta de {next.semester} ainda não foi publicada no SIGAA
                    {start
                        ? `; a matrícula começa em ${fullDate.format(new Date(`${start}T00:00:00Z`))}`
                        : ''}
                    .
                </p>
            )}
            {planning && (
                <p className="px-1 text-xs text-primary">
                    Monte a prévia da sua grade de {next.semester}: ela fica separada da do semestre
                    atual.
                </p>
            )}
        </div>
    );
}
