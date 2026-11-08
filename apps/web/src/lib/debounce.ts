import { useEffect, useState } from 'react';

/** O valor só muda depois de `delay` ms sem mudar, para não consultar a cada tecla. */
export function useDebounced<T>(value: T, delay = 300): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(timer);
    }, [value, delay]);
    return debounced;
}
