/** Mantém diálogos dentro da área visível, inclusive com teclado virtual e zoom. */
export function observeViewport() {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    const update = () => {
        root.style.setProperty(
            '--app-viewport-height',
            `${viewport?.height ?? window.innerHeight}px`
        );
        root.style.setProperty('--app-viewport-top', `${viewport?.offsetTop ?? 0}px`);
    };
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
        viewport?.removeEventListener('resize', update);
        viewport?.removeEventListener('scroll', update);
        window.removeEventListener('resize', update);
        root.style.removeProperty('--app-viewport-height');
        root.style.removeProperty('--app-viewport-top');
    };
}
