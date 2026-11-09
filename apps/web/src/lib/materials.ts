import type { MaterialKind } from '#/queries/community';

import { currentRegularSemester, nextRegularSemester } from '#/lib/offer';

export const MATERIAL_KINDS: MaterialKind[] = ['prova', 'lista', 'resumo', 'anotacao', 'outro'];

export const MATERIAL_KIND_LABELS: Record<MaterialKind, string> = {
    prova: 'Prova',
    lista: 'Lista',
    resumo: 'Resumo',
    anotacao: 'Anotação',
    outro: 'Outro'
};

const OFFICE_MIME = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
];
// os tipos que a API aceita; o tipo real ainda é conferido lá pelo conteúdo
export const ACCEPTED_FILES = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    ...OFFICE_MIME,
    'text/plain',
    '.docx,.pptx,.xlsx,.txt'
].join(',');
export const ACCEPTED_MIME = new Set(
    ACCEPTED_FILES.split(',').filter((type) => type.includes('/'))
);
/** Só PDF e imagem têm prévia; documentos Office e texto são apenas baixados. */
export const PREVIEW_MIME = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

/** Do semestre seguinte ao mais antigo guardado, do mais novo para o mais velho. */
export function materialSemesters(oldest: string, today: string): string[] {
    const current = currentRegularSemester(today);
    if (!current) return [];
    const semesters: string[] = [];
    let semester = nextRegularSemester(current);
    while (semester >= oldest && semesters.length < 12) {
        semesters.push(semester);
        semester = previousRegularSemester(semester);
    }
    return semesters;
}

export function previousRegularSemester(semester: string) {
    const [year = 0, term = 1] = semester.split('.').map(Number);
    return term === 2 ? `${year}.1` : `${year - 1}.2`;
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

/** Por que o arquivo não pode ir, antes de mandar: tipo ou tamanho. */
export function fileProblem(file: File, maxBytes: number): string | null {
    // alguns sistemas não informam o tipo de .docx/.txt; a API confere o conteúdo de qualquer forma
    const type = (file.type.split(';')[0] ?? '').trim().toLowerCase();
    const knownName = !type && /\.(docx|pptx|xlsx|txt)$/i.test(file.name);
    if (!ACCEPTED_MIME.has(type) && !knownName)
        return 'Envie PDF, imagem (PNG, JPEG ou WebP), DOCX, PPTX, XLSX ou texto (.txt).';
    if (file.size > maxBytes) return `O arquivo passa de ${formatBytes(maxBytes)}.`;
    return null;
}
