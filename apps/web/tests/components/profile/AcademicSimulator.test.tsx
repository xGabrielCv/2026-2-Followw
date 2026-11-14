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

const indexNode = (container: HTMLElement, label: string) =>
    [...container.querySelectorAll('dt')].find((node) => node.textContent === label)
        ?.nextElementSibling;
const index = (container: HTMLElement, label: string) => indexNode(container, label)?.textContent;
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
    expect(index(first.container, 'IRA atual')).toBe('4');
    expect(index(first.container, 'MP atual')).toBe('—');
    expect(index(first.container, 'IRA futuro')).toBeUndefined();
    expect(index(first.container, 'MP futuro')).toBeUndefined();
    fireEvent.change(first.getByRole('combobox', current), { target: { value: 'SS' } });
    expect(index(first.container, 'IRA atual')).toBe('4');
    expect(index(first.container, 'MP atual')).toBe('—');
    expect(index(first.container, 'IRA futuro')).toBe('4,667');
    expect(index(first.container, 'MP futuro')).toBe('5');
    expect(first.getByText('* Projeção para 2026.2.')).toBeDefined();
    first.unmount();

    const reopened = render(simulator);
    expect(currentGrade(reopened.container)).toBe('SS');
    expect(index(reopened.container, 'IRA futuro')).toBe('4,667');
    fireEvent.click(reopened.getByRole('button', { name: 'Limpar simulação' }));
    expect(currentGrade(reopened.container)).toBe('');
    expect(index(reopened.container, 'IRA atual')).toBe('4');
    expect(index(reopened.container, 'MP atual')).toBe('—');
    expect(index(reopened.container, 'IRA futuro')).toBeUndefined();
    expect(reopened.queryByText('* Projeção para 2026.2.')).toBeNull();

    // alterar apenas semestre anterior também exibe o impacto como IRA futuro
    fireEvent.click(reopened.getByText('Semestres anteriores'));
    fireEvent.change(reopened.getByRole('combobox', { name: 'Menção de Música, 2026.1' }), {
        target: { value: 'SS' }
    });
    expect(index(reopened.container, 'IRA atual')).toBe('4');
    expect(index(reopened.container, 'IRA futuro')).toBe('5');
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
    expect(index(page.container, 'IRA atual')).toBe('—');
    expect(index(page.container, 'MP atual')).toBe('—');
});

test('separa menções simuladas entre contas no armazenamento existente', () => {
    selectLocalAccount('conta-simulador-a');
    simulatedGrades.set({ '2026.2:A': 'SS' });
    selectLocalAccount('conta-simulador-b');
    expect(simulatedGrades.getSnapshot()).toEqual({});
    selectLocalAccount('conta-simulador-a');
    expect(simulatedGrades.getSnapshot()).toEqual({ '2026.2:A': 'SS' });
});

test('aplica azul ao atual e verde ou vermelho dinâmico ao futuro e à projeção', () => {
    const withBaselineMp: Classroom[] = [
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
            subject: { code: 'B', name: 'FÍSICA', hours: 60 },
            grade: 'MS',
            professors: []
        }
    ];
    const { container, getByRole, getByText } = dom.testing.render(
        <AcademicSimulator
            classrooms={withBaselineMp}
            entry="2026.1"
            current="2026.2"
            curriculum={new Set(['A', 'B'])}
        />
    );
    expect(indexNode(container, 'IRA atual')?.className).toContain('text-info');
    expect(indexNode(container, 'MP atual')?.className).toContain('text-info');

    const chartCss = () => container.querySelector('style')?.textContent ?? '';
    expect(chartCss()).toContain('--color-ira: var(--info)');

    const select = getByRole('combobox', { name: currentLabel });

    // subiu acima do atual -> futuro e linha projetada ficam verdes
    dom.testing.fireEvent.change(select, { target: { value: 'SS' } });
    expect(indexNode(container, 'IRA futuro')?.className).toContain('text-success');
    expect(indexNode(container, 'MP futuro')?.className).toContain('text-success');
    expect(getByText('* Projeção para 2026.2.').className).toContain('text-success');
    expect(chartCss()).toContain('--color-projectedIra: var(--success)');

    // permaneceu igual ao atual (ambos 4) -> os dois continuam verdes
    dom.testing.fireEvent.change(select, { target: { value: 'MS' } });
    expect(index(container, 'IRA atual')).toBe('4');
    expect(index(container, 'IRA futuro')).toBe('4');
    expect(index(container, 'MP atual')).toBe('4');
    expect(index(container, 'MP futuro')).toBe('4');
    expect(indexNode(container, 'IRA futuro')?.className).toContain('text-success');
    expect(indexNode(container, 'MP futuro')?.className).toContain('text-success');
    expect(getByText('* Projeção para 2026.2.').className).toContain('text-success');
    expect(chartCss()).toContain('--color-projectedIra: var(--success)');

    // caiu abaixo do atual -> futuro e linha projetada ficam vermelhos
    dom.testing.fireEvent.change(select, { target: { value: 'MM' } });
    expect(indexNode(container, 'IRA futuro')?.className).toContain('text-destructive');
    expect(indexNode(container, 'MP futuro')?.className).toContain('text-destructive');
    expect(getByText('* Projeção para 2026.2.').className).toContain('text-destructive');
    expect(chartCss()).toContain('--color-projectedIra: var(--destructive)');
});
