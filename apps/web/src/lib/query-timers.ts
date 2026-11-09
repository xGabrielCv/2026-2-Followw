import { timeoutManager } from '@tanstack/react-query';

const MAX_DELAY = 2_147_483_647;
let sequence = 0;

/** Navegadores limitam setTimeout a cerca de 24 dias; retenção pode chegar a 90. */
export function longTimer(callback: () => void, delay: number, repeat = false) {
    const id = ++sequence;
    let deadline = Date.now() + delay;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
        if (cancelled) return;
        const remaining = deadline - Date.now();
        if (remaining > 0) {
            timer = setTimeout(tick, Math.min(remaining, MAX_DELAY));
            return;
        }
        callback();
        if (repeat && !cancelled) {
            deadline = Date.now() + delay;
            timer = setTimeout(tick, Math.min(delay, MAX_DELAY));
        }
    };
    timer = setTimeout(tick, Math.min(Math.max(0, delay), MAX_DELAY));
    return {
        [Symbol.toPrimitive]: () => id,
        cancel: () => {
            cancelled = true;
            clearTimeout(timer);
        }
    };
}

const provider = {
    setTimeout: (callback, delay) => longTimer(callback, delay),
    clearTimeout: (timer) => timer?.cancel(),
    setInterval: (callback, delay) => longTimer(callback, delay, true),
    clearInterval: (timer) => timer?.cancel()
} satisfies import('@tanstack/react-query').TimeoutProvider<ReturnType<typeof longTimer>>;
let initialized = false;
export function initializeQueryTimers() {
    if (initialized) return;
    initialized = true;
    timeoutManager.setTimeoutProvider(provider);
}
