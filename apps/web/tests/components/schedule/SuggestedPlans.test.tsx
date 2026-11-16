import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';

import type { PlannedClass, SchedulePlan } from '#/lib/planned-schedule';

import { SuggestedPlans } from '#/components/schedule/SuggestedPlans';
import { activePlan, schedulePlans } from '#/lib/planned-schedule';
import { suggestSchedules } from '#/lib/schedule-optimizer';
import * as optimizer from '#/lib/schedule-optimizer-runner';

import { useDom } from '../../helpers/dom';

const dom = useDom();
let run: ReturnType<typeof spyOn<typeof optimizer, 'runOptimizer'>>;
beforeEach(() => {
    run = spyOn(optimizer, 'runOptimizer').mockImplementation(async (job) =>
        suggestSchedules(job.subjects, job.preferences)
    );
});
afterEach(() => {
    run.mockRestore();
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

test('sugere grades sem choque, explica e cria uma nova grade ao usar', async () => {
    const page = dom.testing.render(
        <SuggestedPlans plans={plans} semester="2027.1" maxHours={null} />
    );
    expect(page.getByText(/Requisitos ausentes e vagas precisam de conferência/)).toBeDefined();
    dom.testing.fireEvent.click(page.getByRole('button', { name: 'Sugerir grades' }));
    expect(await page.findByText('Opção 1')).toBeDefined();
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

test('avisa quando as obrigatórias não cabem juntas e some com uma só matéria', async () => {
    const clash: SchedulePlan[] = [
        { id: 'g1', name: 'Grade 1', items: [turma('A', '01', '24M12'), turma('B', '01', '24M12')] }
    ];
    const page = dom.testing.render(
        <SuggestedPlans plans={clash} semester="2027.1" maxHours={null} />
    );
    dom.testing.fireEvent.click(page.getByRole('button', { name: 'Sugerir grades' }));
    expect((await page.findByRole('alert')).textContent).toContain('Não existe grade');

    page.rerender(
        <SuggestedPlans
            plans={[{ id: 'g1', name: 'G', items: [turma('A', '01', '24M12')] }]}
            semester="2027.1"
            maxHours={null}
        />
    );
    expect(page.container.textContent).toBe('');
});

test('permite simular futuro com aviso e torna a exigência de requisitos uma escolha explícita', async () => {
    const future: SchedulePlan[] = [
        {
            id: 'g1',
            name: 'Futuro',
            items: [
                turma('A', '01', '24M12'),
                {
                    ...turma('EPS', '01', '35T12'),
                    name: 'ENGENHARIA DE PRODUTO DE SOFTWARE',
                    prerequisites: [[{ code: 'ANTIGA' }]]
                }
            ]
        }
    ];
    const page = dom.testing.render(
        <SuggestedPlans plans={future} semester="2027.1" maxHours={null} />
    );
    dom.testing.fireEvent.click(page.getByRole('button', { name: 'Sugerir grades' }));
    expect(await page.findByText('Opção 1')).toBeDefined();
    expect(page.getByText(/Confira os pré-requisitos/)).toBeDefined();
    dom.testing.fireEvent.click(
        page.getByRole('checkbox', { name: /Exigir requisitos confirmados/ })
    );
    expect(page.queryByText('Opção 1')).toBeNull();
    dom.testing.fireEvent.click(page.getByRole('button', { name: 'Sugerir grades' }));
    expect((await page.findByRole('alert')).textContent).toContain('pré-requisitos');
});
