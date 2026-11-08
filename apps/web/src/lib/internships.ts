import type { InternshipItem } from '#/queries/internships';

/** Sem acento nem caixa, para a busca casar "Programação" com "programacao". */
export const lookupText = (value: string) =>
    value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

export function filterInternships(
    items: InternshipItem[],
    { q, scope, order, bolsa }: { q: string; scope: string; order: string; bolsa: boolean },
    now = new Date()
): InternshipItem[] {
    const text = lookupText(q);
    const open = items.filter(
        (item) =>
            new Date(item.published_until) >= now &&
            (scope === 'all' || item.mine) &&
            (!bolsa || Number(item.stipend ?? 0) > 0) &&
            (!text || lookupText(item.title).includes(text))
    );
    // o mesmo resumo aparece nas duas tabelas do mural: fica um só
    const unique = [
        ...new Map(open.map((item) => [`${item.title}|${item.published_until}`, item])).values()
    ];
    return unique.toSorted((a, b) =>
        order === 'stipend'
            ? Number(b.stipend ?? 0) - Number(a.stipend ?? 0)
            : order === 'recent'
              ? b.published_until.localeCompare(a.published_until)
              : a.published_until.localeCompare(b.published_until)
    );
}
