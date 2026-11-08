import type { TutorialCategory } from '#/queries/community';

export const TUTORIAL_CATEGORIES: TutorialCategory[] = [
    'matricula',
    'estagio',
    'documentos',
    'auxilios',
    'sigaa',
    'campus',
    'outros'
];

export const TUTORIAL_CATEGORY_LABELS: Record<TutorialCategory, string> = {
    matricula: 'Matrícula',
    estagio: 'Estágio',
    documentos: 'Documentos',
    auxilios: 'Auxílios',
    sigaa: 'SIGAA',
    campus: 'Campus',
    outros: 'Outros'
};
