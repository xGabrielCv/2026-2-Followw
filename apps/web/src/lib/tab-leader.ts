/** O que a eleição usa do navegador; separado para poder testar sem um navegador de verdade. */
export interface LockManagerLike {
    request(
        name: string,
        options: { signal?: AbortSignal },
        callback: () => Promise<void>
    ): Promise<unknown>;
}

export interface VisibilityLike {
    visibilityState: string;
    addEventListener(type: 'visibilitychange', listener: () => void): void;
    removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

/**
 * Entre as abas abertas, só uma é "líder" de cada vez (Web Locks): a que está visível. Ao ficar em
 * segundo plano ela solta a vez e outra aba visível assume. Fechar a aba também solta a vez.
 * Devolve a função que desfaz tudo.
 */
export function electLeader({
    name,
    locks,
    doc,
    onChange
}: {
    name: string;
    locks: LockManagerLike;
    doc: VisibilityLike;
    onChange: (leader: boolean) => void;
}): () => void {
    let release: (() => void) | null = null;
    let waiting: AbortController | null = null;
    let stopped = false;

    const request = () => {
        const controller = new AbortController();
        waiting = controller;
        locks
            .request(
                name,
                { signal: controller.signal },
                () =>
                    new Promise<void>((resolve) => {
                        waiting = null;
                        if (stopped || doc.visibilityState !== 'visible') {
                            resolve();
                            return;
                        }
                        release = () => {
                            release = null;
                            onChange(false);
                            resolve();
                        };
                        onChange(true);
                    })
            )
            .catch(() => {
                // pedido cancelado ao ir para segundo plano
            });
    };

    const sync = () => {
        if (stopped) return;
        if (doc.visibilityState === 'visible') {
            if (!release && !waiting) request();
        } else {
            waiting?.abort();
            waiting = null;
            release?.();
        }
    };

    doc.addEventListener('visibilitychange', sync);
    sync();
    return () => {
        stopped = true;
        doc.removeEventListener('visibilitychange', sync);
        waiting?.abort();
        release?.();
    };
}
