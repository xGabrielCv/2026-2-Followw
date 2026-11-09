import { afterEach, expect, test } from 'bun:test';

import type { PlannedClass, SchedulePlan } from '#/lib/planned-schedule';

import { SuggestedPlans } from '#/components/schedule/SuggestedPlans';
import { activePlan, schedulePlans } from '#/lib/planned-schedule';

import { useDom } from '../../helpers/dom';

const dom = useDom();
afterEach(() => {
    dom.testing.cleanup();
    schedulePlans.clear();
});

const turma = (code: string, number: string, schedule: string): PlannedClass => ({
    code,
    name: `MATÉRIA ${code}`,
    hours: 60,
    number,
    semester: '2027.1',
    schedule,
    room: 'S1',
    professors: []
});

const plans: SchedulePlan[] = [
    { id: 'g1', name: 'Grade 1', items: [turma('A', '01', '24M12'), turma('B', '01', '24M12')] },
    { id: 'g2', name: 'Grade 2', items: [turma('A', '02', '35T23'), turma('B', '02', '35M34')] }
];

test('sugere grades sem choque, explica e cria uma nova grade ao usar', () => {
    const page = dom.testing.render(
        <SuggestedPlans plans={plans} semester="2027.1" maxHours={null} />
    );
    expect(page.getByText(/Não sabe de vagas nem de pré-requisitos/)).toBeDefined();
    dom.testing.fireEvent.click(page.getByRole('button', { name: 'Sugerir grades' }));
    expect(page.getByText('Opção 1')).toBeDefined();
    expect(page.container.textContent).toContain('dias no campus');
    // nenhuma opção junta A-01 com B-01 (mesmo horário)
    const options = [...page.container.querySelectorAll('article')];
    expect(options.length).toBeGreaterThan(0);
    for (const option of options)
        expect(
            option.textContent?.includes('turma 01') &&
                option.textContent.match(/turma 01/g)?.length === 2
        ).toBe(false);

    dom.testing.fireEvent.click(page.getAllByRole('button', { name: 'Usar esta grade' })[0]);
    const after = schedulePlans.getSnapshot();
    expect(after.plans.length).toBe(2); // a grade vazia de antes + a nova, já ativa
    expect(
        activePlan(after)
            .items.map((item) => item.code)
            .toSorted()
    ).toEqual(['A', 'B']);
});

test('avisa quando as obrigatórias não cabem juntas e some com uma só matéria', () => {
    const clash: SchedulePlan[] = [
        { id: 'g1', name: 'Grade 1', items: [turma('A', '01', '24M12'), turma('B', '01', '24M12')] }
    ];
    const page = dom.testing.render(
        <SuggestedPlans plans={clash} semester="2027.1" maxHours={null} />
    );
    dom.testing.fireEvent.click(page.getByRole('button', { name: 'Sugerir grades' }));
    expect(page.getByRole('alert').textContent).toContain('Não existe grade');

    page.rerender(
        <SuggestedPlans
            plans={[{ id: 'g1', name: 'G', items: [turma('A', '01', '24M12')] }]}
            semester="2027.1"
            maxHours={null}
        />
    );
    expect(page.container.textContent).toBe('');
});
