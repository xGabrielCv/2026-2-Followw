import { useSyncExternalStore } from 'react';

import { localVault } from '#/lib/local-vault';

function vault() {
    try {
        return typeof window === 'undefined' ? undefined : localVault(window.localStorage);
    } catch {
        return undefined;
    }
}
const subscribe = (listener: () => void) => vault()?.subscribe(listener) ?? (() => {});
const snapshot = () => vault()?.error ?? false;

export function LocalStorageWarning() {
    const failed = useSyncExternalStore(subscribe, snapshot, () => false);
    if (!failed) return null;
    return (
        <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
            Não foi possível salvar neste aparelho. As alterações recentes podem estar só na
            memória. Mantenha esta aba aberta e libere espaço antes de tentar salvar novamente.
        </p>
    );
}
