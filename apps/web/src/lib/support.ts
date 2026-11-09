export const TICKET_CATEGORIES = [
    'bug',
    'help',
    'suggestion',
    'praise',
    'complaint',
    'review_question',
    'material_problem',
    'group_problem',
    'moderation_review',
    'other'
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = {
    bug: 'Problema no app',
    help: 'Preciso de ajuda',
    suggestion: 'Sugestão',
    praise: 'Elogio',
    complaint: 'Reclamação',
    review_question: 'Questionar uma avaliação',
    material_problem: 'Problema em material',
    group_problem: 'Problema em grupo ou dúvida',
    moderation_review: 'Revisão de moderação',
    other: 'Outro assunto'
};

export const TICKET_STATUS_LABELS = {
    open: 'Aberto',
    in_review: 'Em análise',
    waiting_student: 'Aguardando você',
    answered: 'Respondido',
    resolved: 'Resolvido',
    closed: 'Encerrado'
} as const;
export type TicketStatus = keyof typeof TICKET_STATUS_LABELS;

/** CPF, e-mail e matrícula: o servidor recusa, mas avisar antes poupa uma ida e volta. */
const PERSONAL_DATA =
    /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|[\w.+-]+@[\w-]+\.[\w.-]+|\b\d{9}\b|\b\d{2}\/\d{7}\b/;

export function hasPersonalData(...texts: string[]): boolean {
    return texts.some((text) => PERSONAL_DATA.test(text));
}

/** Chamados que ainda esperam alguma ação do aluno ou do atendimento. */
export const OPEN_STATUSES: readonly TicketStatus[] = [
    'open',
    'in_review',
    'waiting_student',
    'answered'
];
