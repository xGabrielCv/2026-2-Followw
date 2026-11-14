import { afterEach, expect, test } from 'bun:test';

import type { Classroom } from '#/queries/classrooms';

import { AcademicSimulator } from '#/components/profile/AcademicSimulator';
import { simulatedGrades } from '#/lib/academic-simulation';
import { selectLocalAccount } from '#/lib/local-storage';

import { useDom } from '../../helpers/dom';

const dom = useDom();
afterEach(() => {
    simulatedGrades.clear();
    selectLocalAccount();
});

const index = (container: HTMLElement, label: string) =>
    [...container.querySelectorAll('dt')].find((node) => node.textContent === label)
        ?.nextElementSibling?.textContent;
const currentLabel = 'Menção de Cálculo, 2026.2';
const currentGrade = (container: HTMLElement) =>
    container.querySelector<HTMLSelectElement>(`[aria-label="${currentLabel}"]`)?.value;

const classrooms: Classroom[] = [
    {
        id: 'atual',
        number: '01',
        semester: '2026.2',
        current: true,
        subject: { code: 'A', name: 'CÁLCULO', hours: 60 },
        professors: []
    },
    {
        id: 'anterior',
        number: '01',
        semester: '2026.1',
        current: false,
        subject: { code: 'B', name: 'MÚSICA', hours: 60 },
        grade: 'MS',
        professors: []
    }
];

test('abre o semestre atual e recolhe as disciplinas anteriores preenchidas pelo SIGAA', () => {
    const { getByText, container } = dom.testing.render(
        <AcademicSimulator
            classrooms={classrooms}
            entry="2026.1"
            current="2026.2"
            curriculum={new Set(['A'])}
        />
    );
    expect(currentGrade(container)).toBe('');
    expect(container.querySelector('details')?.open).toBe(false);
    dom.testing.fireEvent.click(getByText('Semestres anteriores'));
    expect(
        container.querySelector<HTMLSelectElement>('[aria-label="Menção de Música, 2026.1"]')?.value
    ).toBe('MS');
    expect(getByText('Módulo livre')).toBeDefined();
});

test('recalcula na alteração, preserva ao voltar e restaura as menções ao limpar', () => {
    const { render, fireEvent } = dom.testing;
    const simulator = (
        <AcademicSimulator
            classrooms={classrooms}
            entry="2026.1"
            current="2026.2"
            curriculum={new Set(['A'])}
        />
    );
    const first = render(simulator);
    const current = { name: currentLabel };
    expect(index(first.container, 'IRA')).toBe('4');
    fireEvent.change(first.getByRole('combobox', current), { target: { value: 'SS' } });
    expect(index(first.container, 'IRA')).toBe('4,667');
    expect(index(first.container, 'MP')).toBe('5');
    expect(first.getByText('* Projeção para 2026.2.')).toBeDefined();
    first.unmount();

    const reopened = render(simulator);
    expect(currentGrade(reopened.container)).toBe('SS');
    fireEvent.click(reopened.getByRole('button', { name: 'Limpar simulação' }));
    expect(currentGrade(reopened.container)).toBe('');
    expect(index(reopened.container, 'IRA')).toBe('4');
    expect(index(reopened.container, 'MP')).toBe('—');
    expect(reopened.queryByText('* Projeção para 2026.2.')).toBeNull();
});

test('explica os limites da projeção e a ausência de dados para os índices', () => {
    const page = dom.testing.render(
        <AcademicSimulator classrooms={[]} entry={null} current="2026.2" curriculum={null} />
    );
    expect(page.getByText(/Projeção indicativa:/).textContent).toContain('equivalências');
    expect(page.getByText(/Projeção indicativa:/).textContent).toContain('trancamento');
    expect(page.getByText('IRA indisponível sem o semestre de ingresso.')).toBeDefined();
    expect(page.getByText('MP indisponível sem a matriz curricular.')).toBeDefined();
    expect(page.getByText('Nenhuma disciplina no semestre atual.')).toBeDefined();
    expect(index(page.container, 'IRA')).toBe('—');
    expect(index(page.container, 'MP')).toBe('—');
});

test('separa menções simuladas entre contas no armazenamento existente', () => {
    selectLocalAccount('conta-simulador-a');
    simulatedGrades.set({ '2026.2:A': 'SS' });
    selectLocalAccount('conta-simulador-b');
    expect(simulatedGrades.getSnapshot()).toEqual({});
    selectLocalAccount('conta-simulador-a');
    expect(simulatedGrades.getSnapshot()).toEqual({ '2026.2:A': 'SS' });
});
