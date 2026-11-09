import { afterEach, expect, test } from 'bun:test';

import type { CurriculumModel, FlowSubject } from '#/lib/curriculum/types';

import { GraduationPlanner } from '#/components/curriculum/GraduationPlanner';
import { curriculumEdges, unlockedSubjects } from '#/lib/curriculum/relations';

import { useDom } from '../helpers/dom';

const dom = useDom();
afterEach(() => dom.testing.cleanup());

const materia = (code: string, period: number, pre?: string): FlowSubject => ({
    code,
    name: `Matéria ${code}`,
    period,
    hours: 60,
    prerequisites: pre ? [[{ code: pre }]] : undefined
});

function modelo(): CurriculumModel {
    const subjects = [materia('A', 1), materia('B', 2, 'A'), materia('C', 3, 'B'), materia('E', 1)];
    const byCode = new Map(subjects.map((subject) => [subject.code, subject]));
    const edges = curriculumEdges(subjects, byCode);
    return {
        periods: [1, 2, 3],
        subjects,
        byCode,
        edges,
        unlocks: unlockedSubjects(edges, byCode)
    };
}

const pendente = () => 'pending' as const;
const tudoConcluido = () => 'completed' as const;

test('mostra os semestres simulados, compara cargas e avisa que não é integralização', () => {
    const page = dom.testing.render(
        <GraduationPlanner model={modelo()} state={pendente} semester="2026.2" />
    );
    expect(page.getByText('Planejar a formatura')).toBeDefined();
    expect(page.container.textContent).toContain('não é uma confirmação de integralização');
    expect(page.container.textContent).toContain('Faltam 4 matérias e 240h');
    expect(page.getByRole('list', { name: 'Semestres simulados' }).children.length).toBe(3);
    expect(page.container.textContent).toContain('Matérias que mais atrasam');
    expect(page.container.textContent).toContain('2027.1');
});

test('simular uma reprovação acrescenta um semestre e pode ser desfeita', () => {
    const page = dom.testing.render(
        <GraduationPlanner model={modelo()} state={pendente} semester="2026.2" />
    );
    dom.testing.fireEvent.change(page.getByLabelText('E se eu reprovar em…'), {
        target: { value: 'A' }
    });
    expect(page.getByRole('list', { name: 'Semestres simulados' }).children.length).toBe(4);
    expect(page.container.textContent).toContain('reprova (simulação)');
    dom.testing.fireEvent.click(
        page.getByRole('button', { name: /Tirar a reprovação em Matéria A/ })
    );
    expect(page.getByRole('list', { name: 'Semestres simulados' }).children.length).toBe(3);
});

test('fluxo completo: nada a planejar', () => {
    const page = dom.testing.render(
        <GraduationPlanner model={modelo()} state={tudoConcluido} semester="2026.2" />
    );
    expect(page.container.textContent).toContain('O fluxo obrigatório está completo');
});
