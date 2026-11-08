import { ChartPie } from 'lucide-react';
import { useState } from 'react';

import { ShareStatisticsDialog } from '#/components/profile/ShareStatisticsDialog';
import { useOnline } from '#/lib/online';
import { cn } from '#/lib/shadcn';
import { useUpdateSettings, useUserSettings } from '#/queries/settings';

/** Libera as estatísticas de aprovação das turmas do aluno nos índices públicos, sem dado pessoal. */
export function ShareStatisticsSetting() {
    const { shareStatistics } = useUserSettings();
    const update = useUpdateSettings();
    const online = useOnline();
    const [confirming, setConfirming] = useState(false);
    const shared = shareStatistics;
    const save = (value: boolean) =>
        update.mutate(
            { body: { shareStatistics: value } },
            { onSuccess: () => setConfirming(false) }
        );

    return (
        <div className="flex flex-col gap-1 py-2.5">
            <div className="flex items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <ChartPie className="size-4" aria-hidden="true" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-medium" id="share-statistics-label">
                        Compartilhar índices das minhas turmas
                    </span>
                    <span className="text-xs text-muted-foreground">
                        {shared
                            ? 'As aprovações e reprovações das suas turmas ajudam outros alunos.'
                            : 'Ajude outros alunos a ver a reprovação de matérias e docentes.'}
                    </span>
                </div>
                <button
                    type="button"
                    aria-pressed={shared}
                    aria-labelledby="share-statistics-label"
                    disabled={!online || update.isPending}
                    onClick={() => (shared ? save(false) : setConfirming(true))}
                    className={cn(
                        'relative h-6 w-11 shrink-0 rounded-full transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50',
                        shared ? 'bg-primary' : 'bg-muted-foreground/30'
                    )}
                >
                    <span
                        aria-hidden="true"
                        className={cn(
                            'absolute top-0.5 left-0.5 size-5 rounded-full bg-background shadow transition-transform',
                            shared && 'translate-x-5'
                        )}
                    />
                </button>
            </div>
            {update.isError && (
                <p role="alert" className="text-xs text-destructive">
                    Não foi possível salvar. Tente novamente.
                </p>
            )}
            <ShareStatisticsDialog
                open={confirming}
                onOpenChange={setConfirming}
                pending={update.isPending}
                onShare={() => save(true)}
            />
        </div>
    );
}
