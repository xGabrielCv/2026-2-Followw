import { describe, expect, test } from 'bun:test';

import type { CurriculumModel, FlowSubject } from '#/lib/curriculum/types';

import { dependencyChains, planGraduation, type Scenario } from '#/lib/curriculum/graduation';
import { curriculumEdges, unlockedSubjects } from '#/lib/curriculum/relations';

const req = (...codes: string[][]) => codes.map((group) => group.map((code) => ({ code })));

const materia = (
    code: string,
    period: number,
    extra: { pre?: string[][]; co?: string[][]; hours?: number } = {}
): FlowSubject => ({
    code,
    name: `Matéria ${code}`,
    period,
    hours: extra.hours ?? 60,
    prerequisites: extra.pre ? req(...extra.pre) : undefined,
    corequisites: extra.co ? req(...extra.co) : undefined
});

function model(subjects: FlowSubject[]): CurriculumModel {
    const byCode = new Map(subjects.map((subject) => [subject.code, subject]));
    const edges = curriculumEdges(subjects, byCode);
    return {
        periods: [...new Set(subjects.map((subject) => subject.period))],
        subjects,
        byCode,
        edges,
        unlocks: unlockedSubjects(edges, byCode)
    };
}

const nada = () => 'pending' as const;
const concluidaAeCursandoB = (subject: FlowSubject) =>
    subject.code === 'A' ? 'completed' : subject.code === 'B' ? 'enrolled' : 'pending';
const concluidaX = (subject: FlowSubject) => (subject.code === 'X' ? 'completed' : 'pending');
const concluidaZ = (subject: FlowSubject) => (subject.code === 'Z' ? 'completed' : 'pending');
const cenario = (extra: Partial<Scenario> = {}): Scenario => ({
    maxSubjects: 5,
    maxHours: null,
    failures: [],
    ...extra
});
const codes = (plan: ReturnType<typeof planGraduation>) =>
    plan.terms.map((term) => term.subjects.map((subject) => subject.code).toSorted());

describe('planejamento de formatura', () => {
    // A -> B -> C -> D (cadeia) e E independente
    const fluxo = model([
        materia('A', 1),
        materia('B', 2, { pre: [['A']] }),
        materia('C', 3, { pre: [['B']] }),
        materia('D', 4, { pre: [['C']] }),
        materia('E', 1)
    ]);

    test('respeita a cadeia de pré-requisitos: nunca antes do semestre em que ficam liberados', () => {
        const plan = planGraduation(fluxo, nada, cenario());
        expect(codes(plan)).toEqual([['A', 'E'], ['B'], ['C'], ['D']]);
        expect(plan.remainingSemesters).toBe(4);
        expect(plan.remainingSubjects).toBe(5);
        expect(plan.remainingHours).toBe(300);
    });

    test('quem já concluiu não entra, e matéria em curso conta como concluída no fim do semestre', () => {
        const plan = planGraduation(fluxo, concluidaAeCursandoB, cenario());
        expect(codes(plan)).toEqual([['C', 'E'], ['D']]);
        const pessimista = planGraduation(
            fluxo,
            concluidaAeCursandoB,
            cenario({ enrolledPass: false })
        );
        expect(codes(pessimista)[0]).toEqual(['B', 'E']); // B (em curso) precisa ser refeita
    });

    test('carga menor alonga o curso; carga por horas também limita', () => {
        const largo = model([
            materia('A', 1),
            materia('B', 1),
            materia('C', 1),
            materia('D', 1),
            materia('E', 1)
        ]);
        expect(planGraduation(largo, nada, cenario({ maxSubjects: 5 })).terms).toHaveLength(1);
        expect(planGraduation(largo, nada, cenario({ maxSubjects: 2 })).terms).toHaveLength(3);
        const porHoras = planGraduation(largo, nada, cenario({ maxHours: 120 }));
        expect(porHoras.terms.every((term) => term.hours <= 120)).toBe(true);
        expect(porHoras.terms).toHaveLength(3);
    });

    test('reprovar na cabeça da cadeia atrasa tudo em um semestre', () => {
        const base = planGraduation(fluxo, nada, cenario());
        const reprovando = planGraduation(fluxo, nada, cenario({ failures: ['A'] }));
        expect(reprovando.terms).toHaveLength(base.terms.length + 1);
        expect(reprovando.terms[0].failed.map((s) => s.code)).toEqual(['A']);
        expect(codes(reprovando)[0]).toEqual(['E']);
    });

    test('reprovar fora da cadeia crítica não atrasa a formatura', () => {
        const plan = planGraduation(fluxo, nada, cenario({ failures: ['E'] }));
        expect(plan.terms).toHaveLength(4);
    });

    test('grupos alternativos de pré-requisito: basta um inteiro', () => {
        const alt = model([
            materia('A', 1),
            materia('X', 1),
            materia('Y', 2, { pre: [['A', 'X'], ['X']] })
        ]);
        // X sozinho satisfaz o segundo grupo: Y entra no 1º semestre junto com A
        expect(codes(planGraduation(alt, concluidaX, cenario()))).toEqual([['A', 'Y']]);
    });

    test('correquisito entra no mesmo semestre ou depois que o outro foi cumprido', () => {
        const co = model([materia('T', 1), materia('P', 1, { co: [['T']] })]);
        expect(codes(planGraduation(co, nada, cenario()))).toEqual([['P', 'T']]);
        // com espaço para uma só matéria por semestre, o par não cabe junto: fica bloqueado, sem travar
        const apertado = planGraduation(co, nada, cenario({ maxSubjects: 1 }));
        expect(apertado.terms.flatMap((t) => t.subjects.map((s) => s.code))).toContain('T');
        expect(apertado.terms.length).toBeLessThanOrEqual(2);
    });

    test('matérias que mais atrasam vêm primeiro: a cadeia crítica abre o semestre', () => {
        const plan = planGraduation(fluxo, nada, cenario({ maxSubjects: 1 }));
        expect(plan.terms[0].subjects[0].code).toBe('A'); // A libera 3 etapas; E não libera nada
        expect(plan.bottlenecks.map((b) => b.code)).toEqual(['A', 'B', 'C']);
        expect(dependencyChains(fluxo).get('A')).toBe(3);
    });

    test('pré-requisito externo exige confirmação em vez de presumir conclusão', () => {
        const fora = model([materia('A', 1, { pre: [['OPTATIVA-X']] })]);
        expect(planGraduation(fora, nada, cenario()).blocked.map((item) => item.code)).toEqual([
            'A'
        ]);
        expect(
            codes(planGraduation(fora, nada, cenario({ completedCodes: ['OPTATIVA-X'] })))
        ).toEqual([['A']]);
    });

    test('cadeia de correquisitos não coloca par incompleto por falta de espaço', () => {
        const co = model([
            materia('A', 1, { co: [['B']] }),
            materia('B', 1, { co: [['C']] }),
            materia('C', 1)
        ]);
        const plan = planGraduation(co, nada, cenario({ maxSubjects: 2 }));
        expect(codes(plan)).toEqual([['B', 'C'], ['A']]);
    });

    test('dado com ciclo termina e aponta o que ficou bloqueado', () => {
        const ciclo = model([
            materia('A', 1, { pre: [['B']] }),
            materia('B', 2, { pre: [['A']] }),
            materia('C', 1)
        ]);
        const plan = planGraduation(ciclo, nada, cenario());
        expect(codes(plan)).toEqual([['C']]);
        expect(plan.blocked.map((b) => b.code).toSorted()).toEqual(['A', 'B']);
        expect(plan.blocked[0].reason).toContain('pré-requisitos');
    });

    test('tudo concluído: nada a planejar', () => {
        const plan = planGraduation(fluxo, () => 'completed', cenario());
        expect(plan.terms).toEqual([]);
        expect(plan.remainingSubjects).toBe(0);
    });

    test('equivalência concluída cobre a matéria e libera as seguintes', () => {
        const eq = model([
            materia('Z', 1),
            { ...materia('A', 1), equivalences: req(['Z']) },
            materia('B', 2, { pre: [['A']] })
        ]);
        expect(codes(planGraduation(eq, concluidaZ, cenario()))).toEqual([['B']]);
    });
});
