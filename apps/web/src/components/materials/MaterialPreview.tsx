import { Link } from '@tanstack/react-router';
import { lazy, Suspense, useEffect, useState } from 'react';

import type { MaterialItem } from '#/queries/community';

import { Button } from '#/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '#/components/ui/dialog';
import { saveFile } from '#/lib/download';
import { downloadMaterial } from '#/queries/community';

const PdfPreview = lazy(async () => {
    const module = await import('#/components/materials/PdfPreview');
    return { default: module.PdfPreview };
});

export function MaterialPreview({
    code,
    item,
    open,
    onOpenChange
}: {
    code: string;
    item: MaterialItem;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const [attempt, setAttempt] = useState(0);
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="viewport-dialog flex min-w-0 flex-col overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                    <DialogTitle>{item.title}</DialogTitle>
                    <DialogDescription>
                        Confira o conteúdo antes de usar. Se o arquivo estiver incorreto, use a
                        denúncia ou abra um chamado no suporte.
                    </DialogDescription>
                </DialogHeader>
                <Link
                    to="/suporte"
                    search={{ category: 'material_problem', reference: `material:${item.id}` }}
                    className="text-xs font-semibold text-primary underline"
                    onClick={() => onOpenChange(false)}
                >
                    Relatar problema neste arquivo
                </Link>
                {open && (
                    <PreviewContent
                        key={attempt}
                        code={code}
                        item={item}
                        onRetry={() => setAttempt(attempt + 1)}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}

function PreviewContent({
    code,
    item,
    onRetry
}: {
    code: string;
    item: MaterialItem;
    onRetry: () => void;
}) {
    const [preview, setPreview] = useState<{ url: string; blob: Blob }>();
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        const controller = new AbortController();
        let url: string | undefined;
        void downloadMaterial(code, item.id, controller.signal)
            .then((blob) => {
                if (controller.signal.aborted) return undefined;
                if (
                    blob.type !== item.mime ||
                    !['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(
                        blob.type
                    )
                )
                    throw new Error('Tipo inesperado');
                url = URL.createObjectURL(blob);
                setPreview({ url, blob });
                return undefined;
            })
            .catch(() => {
                if (!controller.signal.aborted) setFailed(true);
            });
        return () => {
            controller.abort();
            if (url) URL.revokeObjectURL(url);
        };
    }, [code, item.id, item.mime]);
    if (failed)
        return (
            <div className="flex flex-col gap-2">
                <p role="alert">Não foi possível visualizar este arquivo.</p>
                <Button variant="outline" onClick={onRetry}>
                    Tentar novamente
                </Button>
            </div>
        );
    if (!preview) return <output>Carregando prévia...</output>;
    return (
        <div className="flex min-w-0 flex-col gap-3">
            {item.mime === 'application/pdf' ? (
                <Suspense fallback={<output>Preparando PDF...</output>}>
                    <PdfPreview blob={preview.blob} title={item.title} />
                </Suspense>
            ) : (
                <img
                    src={preview.url}
                    alt={item.title}
                    className="max-h-96 w-full rounded-lg object-contain"
                />
            )}
            <Button variant="outline" onClick={() => saveFile(preview.blob, item.filename)}>
                Baixar arquivo
            </Button>
        </div>
    );
}
