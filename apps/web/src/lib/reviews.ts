import type { Attendance } from '#/queries/reviews';

export const ATTENDANCE_OPTIONS: Attendance[] = ['cobra', 'nao_cobra', 'varia'];

export const ATTENDANCE_LABELS: Record<Attendance, string> = {
    cobra: 'Cobra',
    nao_cobra: 'Não cobra',
    varia: 'Varia'
};

export function ratingLabel(rating: number): string {
    if (rating >= 90) return 'excelente';
    if (rating >= 70) return 'boa';
    if (rating >= 40) return 'regular';
    return 'ruim';
}

/** Cor da nota: verde nas boas, amarelo nas regulares, vermelho nas ruins. */
export function ratingTone(rating: number): string {
    if (rating >= 70) return 'text-primary';
    if (rating >= 40) return 'text-warning';
    return 'text-destructive';
}

export const formatRating = (average: number) =>
    average.toLocaleString('pt-BR', { maximumFractionDigits: 0 });

const MONTHS = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric' });

/** `2026-11` → `nov. de 2026`. */
export function reviewMonth(month: string): string {
    const [year, number] = month.split('-').map(Number);
    return MONTHS.format(new Date(year ?? 2000, (number ?? 1) - 1, 1));
}
