import { afterEach, expect, test } from 'bun:test';

import type { CurriculumModel, FlowSubject } from '#/lib/curriculum/types';

import { GraduationPlanner } from '#/components/curriculum/GraduationPlanner';
import { curriculumEdges, unlockedSubjects } from '#/lib/curriculum/relations';
import { localStorageRepository } from '#/lib/local-storage';

import { useDom } from '../helpers/dom';

const dom = useDom();
afterEach(() => {
    dom.testing.cleanup();
    localStorageRepository.clear();
});

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

const details = {
    registration: '251000001',
    curriculum: {
        sigaa_id: 1,
        code: 'SINTETICO',
        course_id: 1,
        entry_semester: '2026.1',
        valid_from: '2026.1',
        matrix: 'Matriz sintética',
        shift: null,
        degree: null,
        modality: null,
        periods: [],
        complementary: []
    },
    workload: {
        total: 3000,
        pending_mandatory: 240,
        pending_optional: 120,
        pending_complementary: 60
    },
    maxWorkload: 480,
    completedCodes: []
};

test('mostra os semestres simulados, compara cargas e avisa que não é integralização', () => {
    const page = dom.testing.render(
        <GraduationPlanner {...details} model={modelo()} state={pendente} semester="2026.2" />
    );
    expect(page.getByText('Planejar a formatura')).toBeDefined();
    expect(page.container.textContent).toContain('Não é uma confirmação de integralização');
    expect(page.container.textContent).toContain('Faltam 4 matérias e 240h');
    expect(page.getByRole('list', { name: 'Semestres simulados' }).children.length).toBe(3);
    expect(page.container.textContent).toContain('Matérias que mais atrasam');
    expect(page.container.textContent).toContain('2027.1');
});

test('simular uma reprovação acrescenta um semestre e pode ser desfeita', () => {
    const page = dom.testing.render(
        <GraduationPlanner {...details} model={modelo()} state={pendente} semester="2026.2" />
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
        <GraduationPlanner {...details} model={modelo()} state={tudoConcluido} semester="2026.2" />
    );
    expect(page.container.textContent).toContain('disciplinas selecionadas está completo');
    expect(page.getByText('Optativas pendentes no SIGAA')).toBeDefined();
});

test('mostra as pendências do SIGAA sem que a simulação as altere', () => {
    const page = dom.testing.render(
        <GraduationPlanner {...details} model={modelo()} state={pendente} semester="2026.2" />
    );
    const antes = page.container.textContent;
    expect(antes).toContain('240h');
    expect(antes).toContain('120h');
    expect(antes).toContain('60h');
    dom.testing.fireEvent.change(page.getByLabelText('Matérias por semestre'), {
        target: { value: '3' }
    });
    expect(page.getByText('Complementares pendentes no SIGAA').nextSibling?.textContent).toBe(
        '60h'
    );
});

const subject = (code: string, name = `Matéria ${code}`) => ({ code, name, hours: 60 });

test('optativa escolhida entra na projeção e a escolha continua salva ao reabrir', () => {
    const comOptativa = {
        ...details,
        curriculum: {
            ...details.curriculum,
            periods: [
                { period: 1, subjects: [subject('A'), subject('E')] },
                { period: 2, subjects: [subject('B')] },
                { period: 3, subjects: [subject('C')] }
            ],
            complementary: [subject('OPT1', 'OPTATIVA UM')]
        }
    };
    const render = () =>
        dom.testing.render(
            <GraduationPlanner
                {...comOptativa}
                model={modelo()}
                state={pendente}
                semester="2026.2"
            />
        );
    const first = render();
    expect(first.container.textContent).toContain('Faltam 4 matérias e 240h');
    dom.testing.fireEvent.click(first.getByLabelText(/Optativa Um/));
    expect(first.container.textContent).toContain('Faltam 5 matérias e 300h');
    first.unmount();

    const reopened = render();
    expect(reopened.container.textContent).toContain('Faltam 5 matérias e 300h');
    expect(reopened.getByLabelText(/Optativa Um/)).toHaveProperty('checked', true);
});

test('a carga escolhida por semestre fica só neste aparelho, separada por conta', () => {
    const render = (registration: string) =>
        dom.testing.render(
            <GraduationPlanner
                {...details}
                registration={registration}
                model={modelo()}
                state={pendente}
                semester="2026.2"
            />
        );
    const first = render('251000001');
    dom.testing.fireEvent.change(first.getByLabelText('Matérias por semestre'), {
        target: { value: '3' }
    });
    first.unmount();
    expect(render('251000001').getByLabelText('Matérias por semestre')).toHaveProperty(
        'value',
        '3'
    );
    dom.testing.cleanup();
    expect(render('251000002').getByLabelText('Matérias por semestre')).toHaveProperty(
        'value',
        '5'
    );
});
