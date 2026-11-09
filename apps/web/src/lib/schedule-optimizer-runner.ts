import type { Result } from '#/lib/schedule-optimizer';
import type { OptimizerJob } from '#/lib/schedule-optimizer.worker';

/** Invocado pelos controles do navegador; a busca fica fora da thread da interface. */
export function runOptimizer(job: OptimizerJob, signal: AbortSignal): Promise<Result> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new DOMException('Busca cancelada', 'AbortError'));
            return;
        }
        const worker = new Worker(new URL('./schedule-optimizer.worker.ts', import.meta.url), {
            type: 'module'
        });
        const finish = () => {
            worker.terminate();
            clearTimeout(timer);
            signal.removeEventListener('abort', cancel);
        };
        const cancel = () => {
            finish();
            reject(new DOMException('Busca cancelada', 'AbortError'));
        };
        const timer = setTimeout(() => {
            finish();
            reject(new Error('Tempo limite da simulação'));
        }, 3000);
        signal.addEventListener('abort', cancel, { once: true });
        worker.addEventListener(
            'message',
            (event: MessageEvent<{ result?: Result; failed?: boolean }>) => {
                finish();
                if (event.data.result) resolve(event.data.result);
                else reject(new Error('Não foi possível calcular as grades'));
            },
            { once: true }
        );
        worker.addEventListener(
            'error',
            () => {
                finish();
                reject(new Error('Não foi possível iniciar a simulação'));
            },
            { once: true }
        );
        try {
            worker.postMessage(job, []);
        } catch {
            finish();
            reject(new Error('Não foi possível preparar a simulação'));
        }
    });
}
