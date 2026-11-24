import { useCanGoBack, useRouter } from '@tanstack/react-router';

export function useGoBack() {
    const router = useRouter();
    const canGoBack = useCanGoBack();

    return (event: React.MouseEvent) => {
        if (
            !canGoBack ||
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
        )
            return;
        event.preventDefault();
        router.history.back();
    };
}
