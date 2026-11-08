import { useEffect, useState } from 'react';

import { formatDuration, nowInBrasilia } from '#/lib/schedule';

const minutes = (time: string) => {
    const [hour = 0, minute = 0] = time.split(':').map(Number);
    return hour * 60 + minute;
};

/** "termina em 35 min" na aula em andamento; "começa em 1h10" na próxima. */
export function countdown(
    status: 'in_progress' | 'next' | 'normal',
    start: string,
    end: string,
    now: string
): string | null {
    if (status === 'in_progress') {
        const left = minutes(end) - minutes(now);
        return left > 0 ? `termina em ${formatDuration(left)}` : null;
    }
    if (status === 'next') {
        const left = minutes(start) - minutes(now);
        return left > 0 ? `começa em ${formatDuration(left)}` : null;
    }
    return null;
}

/** A hora de Brasília (HH:MM), atualizada a cada 30 s; no SSR, nula para não divergir. */
export function useClock(): string | null {
    const [time, setTime] = useState<string | null>(null);
    useEffect(() => {
        const tick = () => setTime(nowInBrasilia().time);
        tick();
        const id = setInterval(tick, 30_000);
        return () => clearInterval(id);
    }, []);
    return time;
}
