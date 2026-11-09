// oxlint-disable-next-line import/default -- Vite transforma ?url no endereço local do arquivo
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

const resources = import.meta.glob<string>('/node_modules/pdfjs-dist/{standard_fonts,cmaps}/*', {
    query: '?url',
    import: 'default',
    eager: true
});

class LocalPdfData {
    async fetch({ kind, filename }: { kind: string; filename: string }) {
        const folder =
            kind === 'standardFontDataUrl' ? 'standard_fonts' : kind === 'cMapUrl' ? 'cmaps' : '';
        const url = resources[`/node_modules/pdfjs-dist/${folder}/${filename}`];
        if (!url || filename.includes('/')) throw new Error('Recurso de PDF indisponível');
        const response = await globalThis.fetch(url, {
            credentials: 'omit',
            referrerPolicy: 'no-referrer'
        });
        if (!response.ok) throw new Error('Recurso de PDF indisponível');
        return new Uint8Array(await response.arrayBuffer());
    }
}

/** Só pixels: não monta links, formulários, scripts ou anexos do documento. */
export async function pdfPreviewTask(blob: Blob) {
    const [pdf, bytes] = await Promise.all([import('pdfjs-dist'), blob.arrayBuffer()]);
    pdf.GlobalWorkerOptions.workerSrc = workerUrl;
    return pdf.getDocument({
        data: new Uint8Array(bytes),
        useWorkerFetch: false,
        BinaryDataFactory: LocalPdfData,
        useWasm: false,
        enableXfa: false,
        maxImageSize: 4_000_000,
        canvasMaxAreaInBytes: 16_000_000,
        verbosity: 0
    });
}
