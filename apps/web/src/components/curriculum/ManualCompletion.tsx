import { createContext, useContext } from 'react';

export interface ManualCompletion {
    codes: ReadonlySet<string>;
    toggle: (code: string) => Promise<void>;
    pending: boolean;
    failed: boolean;
}

// só existe no fluxo do próprio curso, com login
export const ManualCompletionContext = createContext<ManualCompletion | null>(null);

export const useManualCompletion = () => useContext(ManualCompletionContext);
