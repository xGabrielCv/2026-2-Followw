import type { Page } from '@playwright/test';

/** Mede texto pintado; scrollWidth sozinho não detecta conteúdo cortado pelo body. */
export async function overflowingText(page: Page, selector = 'main') {
    return page.locator(selector).evaluateAll((roots) => {
        const found: string[] = [];
        for (const root of roots) {
            const boundary = root.getBoundingClientRect();
            const left = Math.max(0, boundary.left);
            const right = Math.min(innerWidth, boundary.right);
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            let node: Node | null;
            while ((node = walker.nextNode())) {
                if (!node.textContent?.trim()) continue;
                let element = node.parentElement;
                let intentional = false;
                while (element && element !== root) {
                    const style = getComputedStyle(element);
                    if (
                        style.clipPath === 'inset(50%)' ||
                        style.visibility === 'hidden' ||
                        style.display === 'none' ||
                        element.classList.contains('sr-only') ||
                        style.textOverflow === 'ellipsis' ||
                        (style.getPropertyValue('-webkit-line-clamp') !== 'none' &&
                            style.getPropertyValue('-webkit-line-clamp') !== '') ||
                        ['auto', 'scroll'].includes(style.overflowX)
                    ) {
                        intentional = true;
                        break;
                    }
                    element = element.parentElement;
                }
                if (intentional) continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                if (
                    [...range.getClientRects()].some(
                        (rect) => rect.width > 0 && (rect.left < left - 1 || rect.right > right + 1)
                    )
                )
                    found.push(
                        node.textContent.trim().slice(0, 100) +
                            ' | ' +
                            node.parentElement?.outerHTML.slice(0, 500)
                    );
            }
        }
        return found;
    });
}
