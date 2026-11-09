import type { AcademicState, CurriculumModel, FlowSubject } from '#/lib/curriculum/types';

/**
 * Projeção dos semestres que faltam, só com o fluxo obrigatório do curso e o histórico do aluno.
 * É uma estimativa por regras: respeita pré-requisitos (qualquer grupo alternativo inteiro
 * cumprido) e correquisitos (no mesmo semestre ou antes), a carga escolhida e as reprovações que o
 * aluno quiser simular. NÃO confirma integralização, optativas, complementares, vagas, oferta por
 * semestre nem pré-requisitos de matérias fora do fluxo obrigatório (tratados como cumpridos).
 */

export interface Scenario {
    /** quantidade máxima de matérias por semestre */
    maxSubjects: number;
    /** limite de horas por semestre; `null` = só pela quantidade */
    maxHours: number | null;
    /** matérias em que o aluno reprova na primeira tentativa (gasta o semestre e repete) */
    failures: string[];
    /** as matérias "em curso" terminam aprovadas? (padrão: sim) */
    enrolledPass?: boolean;
}

export interface Term {
    /** 1 = próximo semestre */
    index: number;
    subjects: FlowSubject[];
    /** matérias reprovadas neste semestre (simulação) */
    failed: FlowSubject[];
    hours: number;
}

export interface GraduationPlan {
    terms: Term[];
    remainingSemesters: number;
    remainingSubjects: number;
    remainingHours: number;
    /** matérias que mais atrasam: maior cadeia de dependentes por trás delas */
    bottlenecks: { code: string; name: string; chain: number; unlocks: number }[];
    /** não entraram no plano e por quê (ciclo, dado faltando) */
    blocked: { code: string; name: string; reason: string }[];
}

export const MAX_TERMS = 20;

type Groups = FlowSubject['prerequisites'];

const inModel = (model: CurriculumModel, code: string) => model.byCode.has(code);

/** Algum grupo inteiro cumprido; exigências fora do fluxo obrigatório não bloqueiam. */
function groupsMet(model: CurriculumModel, groups: Groups, done: ReadonlySet<string>): boolean {
    if (!groups?.length) return true;
    return groups.some(
        (group) =>
            group.length > 0 && group.every(({ code }) => !inModel(model, code) || done.has(code))
    );
}

function covers(subject: FlowSubject, done: ReadonlySet<string>) {
    return (
        done.has(subject.code) ||
        (subject.equivalences?.some(
            (group) => group.length > 0 && group.every(({ code }) => done.has(code))
        ) ??
            false)
    );
}

/** Para cada matéria, o tamanho da maior cadeia de dependentes (diretos e indiretos) depois dela. */
export function dependencyChains(model: CurriculumModel): Map<string, number> {
    const chain = new Map<string, number>();
    const visiting = new Set<string>();
    const visit = (code: string): number => {
        const known = chain.get(code);
        if (known !== undefined) return known;
        if (visiting.has(code)) return 0; // ciclo no dado: não trava
        visiting.add(code);
        const dependents = (model.unlocks.get(code) ?? []).filter((next) => next.code !== code);
        const value = dependents.length ? 1 + Math.max(...dependents.map((s) => visit(s.code))) : 0;
        visiting.delete(code);
        chain.set(code, value);
        return value;
    };
    for (const subject of model.subjects) visit(subject.code);
    return chain;
}

export function planGraduation(
    model: CurriculumModel,
    state: (subject: FlowSubject) => AcademicState,
    scenario: Scenario
): GraduationPlan {
    const chain = dependencyChains(model);
    const done = new Set<string>();
    const enrolled: FlowSubject[] = [];
    for (const subject of model.subjects) {
        const current = state(subject);
        if (current === 'completed') done.add(subject.code);
        else if (current === 'enrolled') enrolled.push(subject);
    }
    if (scenario.enrolledPass !== false) for (const subject of enrolled) done.add(subject.code);
    // matéria coberta por um grupo de equivalências concluído vale como concluída (e libera as seguintes)
    for (const subject of model.subjects) if (covers(subject, done)) done.add(subject.code);
    const open = model.subjects.filter((subject) => !done.has(subject.code));
    const remainingHours = open.reduce((total, subject) => total + (subject.hours ?? 0), 0);

    const pending = new Map(open.map((subject) => [subject.code, subject]));
    const failedOnce = new Set<string>();
    const terms: Term[] = [];
    const priority = (a: FlowSubject, b: FlowSubject) =>
        (chain.get(b.code) ?? 0) - (chain.get(a.code) ?? 0) ||
        (model.unlocks.get(b.code)?.length ?? 0) - (model.unlocks.get(a.code)?.length ?? 0) ||
        a.period - b.period ||
        a.code.localeCompare(b.code);

    while (pending.size > 0 && terms.length < MAX_TERMS) {
        const candidates = [...pending.values()]
            .filter((subject) => groupsMet(model, subject.prerequisites, done))
            .toSorted(priority);
        const chosen: FlowSubject[] = [];
        let hours = 0;
        const fits = (subject: FlowSubject) =>
            chosen.length < scenario.maxSubjects &&
            (scenario.maxHours == null || hours + (subject.hours ?? 0) <= scenario.maxHours);
        const take = (subject: FlowSubject) => {
            chosen.push(subject);
            hours += subject.hours ?? 0;
        };
        for (const subject of candidates) {
            if (chosen.includes(subject) || !fits(subject)) continue;
            // correquisito: precisa estar cumprido ou entrar junto neste semestre
            const needed = (subject.corequisites ?? [])
                .flatMap((group) => (group.length ? [group.map(({ code }) => code)] : []))
                .filter((codes) => codes.every((code) => inModel(model, code)));
            const together = needed.length
                ? needed.find((codes) => codes.every((code) => done.has(code)))
                    ? []
                    : (needed
                          .map((codes) =>
                              codes
                                  .filter(
                                      (code) =>
                                          !done.has(code) && !chosen.some((c) => c.code === code)
                                  )
                                  .map((code) => pending.get(code))
                          )
                          .find((list) =>
                              list.every((item) => item && candidates.includes(item))
                          ) ?? null)
                : [];
            if (together === null) continue;
            const extra = together.filter((item): item is FlowSubject => item !== undefined);
            const extraHours = extra.reduce((total, item) => total + (item.hours ?? 0), 0);
            if (
                chosen.length + 1 + extra.length > scenario.maxSubjects ||
                (scenario.maxHours != null &&
                    hours + (subject.hours ?? 0) + extraHours > scenario.maxHours)
            )
                continue;
            take(subject);
            for (const item of extra) take(item);
        }
        if (chosen.length === 0) break;
        const failed = chosen.filter(
            (subject) => scenario.failures.includes(subject.code) && !failedOnce.has(subject.code)
        );
        for (const subject of failed) failedOnce.add(subject.code);
        const passed = chosen.filter((subject) => !failed.includes(subject));
        for (const subject of passed) {
            done.add(subject.code);
            pending.delete(subject.code);
        }
        terms.push({ index: terms.length + 1, subjects: passed, failed, hours });
    }

    const blocked = [...pending.values()].map((subject) => ({
        code: subject.code,
        name: subject.name,
        reason: groupsMet(model, subject.prerequisites, done)
            ? 'não coube nos semestres simulados'
            : 'os pré-requisitos não puderam ser cumpridos no fluxo obrigatório'
    }));
    const bottlenecks = open
        .map((subject) => ({
            code: subject.code,
            name: subject.name,
            chain: chain.get(subject.code) ?? 0,
            unlocks: model.unlocks.get(subject.code)?.length ?? 0
        }))
        .filter((entry) => entry.chain > 0)
        .toSorted(
            (a, b) => b.chain - a.chain || b.unlocks - a.unlocks || a.code.localeCompare(b.code)
        )
        .slice(0, 5);

    return {
        terms,
        remainingSemesters: terms.length,
        remainingSubjects: open.length,
        remainingHours,
        bottlenecks,
        blocked
    };
}

export const SCENARIOS: { id: string; label: string; scenario: Scenario }[] = [
    {
        id: 'light',
        label: 'Leve (4 matérias)',
        scenario: { maxSubjects: 4, maxHours: null, failures: [] }
    },
    {
        id: 'normal',
        label: 'Normal (5 matérias)',
        scenario: { maxSubjects: 5, maxHours: null, failures: [] }
    },
    {
        id: 'heavy',
        label: 'Pesada (7 matérias)',
        scenario: { maxSubjects: 7, maxHours: null, failures: [] }
    }
];
