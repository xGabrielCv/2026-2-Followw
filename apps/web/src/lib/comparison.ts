import type { Classroom } from '#/queries/classrooms';
import type { Comparison, SubjectRate } from '#/queries/comparison';

// Tudo aqui roda no aparelho: o histórico do aluno nunca vai para a API.

const APPROVED = new Set(['SS', 'MS', 'MM']);
const FAILED = new Set(['MI', 'II', 'SR']);

export interface Mine {
    // matérias encerradas com menção, pelo código (a última tentativa vale)
    approved: Set<string>;
    failed: Set<string>;
    total: number;
}

export function myResults(history: readonly Classroom[]): Mine {
    const last = new Map<string, Classroom>();
    for (const item of history.toSorted((a, b) => a.semester.localeCompare(b.semester))) {
        if (!item.current && item.grade) last.set(item.subject.code, item);
    }
    const approved = new Set<string>();
    const failed = new Set<string>();
    for (const [code, item] of last) {
        if (APPROVED.has(item.grade ?? '')) approved.add(code);
        else if (FAILED.has(item.grade ?? '')) failed.add(code);
    }
    return { approved, failed, total: approved.size + failed.size };
}

/** Sua aprovação nas tentativas com menção (cada tentativa conta). */
export function myApprovalRate(history: readonly Classroom[]): number | null {
    const graded = history.filter((item) => !item.current && item.grade);
    if (!graded.length) return null;
    const ok = graded.filter((item) => APPROVED.has(item.grade ?? '')).length;
    return Math.round((ok * 1000) / graded.length) / 10;
}

const average = (values: number[]) =>
    values.length
        ? Math.round((values.reduce((a, b) => a + b, 0) * 10) / values.length) / 10
        : null;

export interface Insights {
    myRate: number | null;
    // aprovação média das turmas das mesmas matérias que você cursou
    sameSubjectsRate: number | null;
    // reprovação média das matérias que você cursou, contra a do curso (ou da UnB)
    myDifficulty: number | null;
    scopeDifficulty: number | null;
    hardestPassed: SubjectRate[];
    hardestAhead: SubjectRate[];
    covered: number;
}

export function insights(
    history: readonly Classroom[],
    data: Comparison,
    scope: 'course' | 'unb'
): Insights {
    const mine = myResults(history);
    const taken = new Set([...mine.approved, ...mine.failed]);
    const rates = new Map(data.subjects.map((item) => [item.code, item]));
    const takenRates = [...taken].flatMap((code) => rates.get(code) ?? []);
    const reference = scope === 'course' ? (data.course ?? data.unb) : data.unb;
    const started = new Set(history.map((item) => item.subject.code));
    return {
        myRate: myApprovalRate(history),
        sameSubjectsRate: average(takenRates.map((item) => item.rates.approved)),
        myDifficulty: average(takenRates.map((item) => item.rates.failed)),
        scopeDifficulty: reference?.failed ?? null,
        hardestPassed: takenRates
            .filter((item) => mine.approved.has(item.code))
            .toSorted((a, b) => b.rates.failed - a.rates.failed)
            .slice(0, 5),
        hardestAhead: data.subjects
            .filter((item) => !started.has(item.code))
            .toSorted((a, b) => b.rates.failed - a.rates.failed)
            .slice(0, 5),
        covered: takenRates.length
    };
}

/** "8,2 pontos acima" / "abaixo" / "igual", para a frase de comparação. */
export function difference(mine: number | null, other: number | null): string | null {
    if (mine === null || other === null) return null;
    const delta = Math.round((mine - other) * 10) / 10;
    if (Math.abs(delta) < 0.5) return 'igual à média';
    const points = Math.abs(delta).toLocaleString('pt-BR');
    return `${points} pontos ${delta > 0 ? 'acima' : 'abaixo'} da média`;
}
