import { MonitorSmartphone } from 'lucide-react';
import { useSyncExternalStore } from 'react';

import type { LayoutMode } from '#/lib/layout';

import { TabFilter } from '#/components/TabFilter';
import { LAYOUT_LABELS, readLayoutMode, saveLayoutMode, subscribeLayoutMode } from '#/lib/layout';

const MODES: LayoutMode[] = ['auto', 'mobile', 'desktop'];

/** Força o layout de celular ou de computador, para ver como fica em outro aparelho. */
export function LayoutModeSetting() {
    // No SSR não há localStorage: renderiza o automático e o cliente corrige ao hidratar.
    const mode = useSyncExternalStore(subscribeLayoutMode, readLayoutMode, () => 'auto' as const);

    return (
        <div className="flex flex-col gap-2 py-2.5">
            <div className="flex items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <MonitorSmartphone className="size-4" aria-hidden="true" />
                </span>
                <div className="flex min-w-0 flex-col">
                    <span className="text-sm font-medium">Visualização</span>
                    <span className="text-xs text-muted-foreground">
                        {mode === 'auto'
                            ? 'Escolhida pelo tamanho da tela.'
                            : `Layout de ${LAYOUT_LABELS[mode].toLowerCase()} neste aparelho.`}
                    </span>
                </div>
            </div>
            <TabFilter
                label="Visualização do aplicativo"
                value={mode}
                options={MODES}
                labels={LAYOUT_LABELS}
                onChange={saveLayoutMode}
            />
        </div>
    );
}
