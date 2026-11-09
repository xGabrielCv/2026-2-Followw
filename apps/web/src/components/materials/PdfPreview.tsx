/* oxlint-disable jsx-a11y/prefer-tag-over-role -- canvas precisa expor a página como imagem acessível */
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist';

import { useEffect, useRef, useState } from 'react';

import { Button } from '#/components/ui/button';
import { pdfPreviewTask } from '#/queries/pdf-preview';

export function PdfPreview({ blob, title }: { blob: Blob; title: string }) {
    const [document, setDocument] = useState<PDFDocumentProxy>();
    const [failed, setFailed] = useState(false);
    const [page, setPage] = useState(1);
    useEffect(() => {
        let cancelled = false;
        let task: PDFDocumentLoadingTask | undefined;
        const timer = setTimeout(() => {
            cancelled = true;
            setFailed(true);
            void task?.destroy().catch(() => {});
        }, 15_000);
        void pdfPreviewTask(blob)
            .then(async (loading) => {
                task = loading;
                if (cancelled) {
                    await loading.destroy();
                    return undefined;
                }
                const loaded = await loading.promise;
                if (loaded.numPages > 300) throw new Error('Documento muito extenso');
                if (!cancelled) setDocument(loaded);
                return undefined;
            })
            .catch(() => {
                if (!cancelled) setFailed(true);
                void task?.destroy().catch(() => {});
            })
            .finally(() => clearTimeout(timer));
        return () => {
            cancelled = true;
            clearTimeout(timer);
            void task?.destroy().catch(() => {});
        };
    }, [blob]);
    if (failed)
        return (
            <p role="alert">
                Não foi possível montar a prévia deste PDF. Você pode baixar o arquivo.
            </p>
        );
    if (!document) return <output>Preparando PDF...</output>;
    return (
        <div className="flex min-w-0 flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
                <Button
                    size="sm"
                    variant="outline"
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                >
                    Anterior
                </Button>
                <output>
                    Página {page} de {document.numPages}
                </output>
                <Button
                    size="sm"
                    variant="outline"
                    disabled={page === document.numPages}
                    onClick={() => setPage(page + 1)}
                >
                    Próxima
                </Button>
            </div>
            <PdfPage key={page} document={document} number={page} title={title} />
        </div>
    );
}

function PdfPage({
    document,
    number,
    title
}: {
    document: PDFDocumentProxy;
    number: number;
    title: string;
}) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
    useEffect(() => {
        let cancelled = false;
        let task: RenderTask | undefined;
        const timer = setTimeout(() => {
            cancelled = true;
            task?.cancel();
            setState('failed');
        }, 15_000);
        void document
            .getPage(number)
            .then(async (page) => {
                const element = canvas.current;
                if (cancelled || !element) return undefined;
                const size = page.getViewport({ scale: 1 });
                const scale = Math.min(
                    2,
                    1200 / size.width,
                    Math.sqrt(4_000_000 / (size.width * size.height))
                );
                if (!Number.isFinite(scale) || scale <= 0) throw new Error('Página inválida');
                const viewport = page.getViewport({ scale });
                element.width = Math.ceil(viewport.width);
                element.height = Math.ceil(viewport.height);
                task = page.render({ canvas: element, viewport, annotationMode: 0 });
                await task.promise;
                if (!cancelled) setState('ready');
                return undefined;
            })
            .catch(() => {
                if (!cancelled) setState('failed');
            })
            .finally(() => clearTimeout(timer));
        return () => {
            cancelled = true;
            clearTimeout(timer);
            task?.cancel();
        };
    }, [document, number]);
    return (
        <div className="flex min-w-0 flex-col gap-2">
            {state === 'loading' && <output>Renderizando página...</output>}
            {state === 'failed' && (
                <p role="alert">
                    Não foi possível visualizar esta página. Você pode baixar o arquivo.
                </p>
            )}
            <canvas
                ref={canvas}
                role="img"
                aria-label={`${title}, página ${number}`}
                data-rendered={state === 'ready'}
                className="max-h-96 w-full rounded-lg border object-contain"
            />
        </div>
    );
}
