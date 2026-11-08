import {
    createMemoryHistory,
    createRootRoute,
    createRouter,
    RouterProvider
} from '@tanstack/react-router';
import { afterEach, expect, test } from 'bun:test';

import type { FlowStatistics } from '#/lib/curriculum/statistics';

import { FlowStatisticsView } from '#/components/curriculum/FlowStatistics';

import { useDom } from '../../helpers/dom';

const dom = useDom();
afterEach(() => dom.testing.cleanup());

const subject = (code: string, name: string) => ({ code, name, period: 2, hours: 60 });
const flow: FlowStatistics = {
    total: { subjects: 10, hours: 600 },
    completed: { subjects: 4, hours: 240 },
    enrolled: { subjects: 2, hours: 120 },
    overdue: [subject('FGA0302', 'ENGENHARIA E AMBIENTE')],
    available: [subject('MAT0026', 'CÁLCULO 2')],
    periods: [{ period: 1, total: 5, completed: 4, enrolled: 1 }],
    remainingSemesters: 3
};

async function render(props: Partial<React.ComponentProps<typeof FlowStatisticsView>> = {}) {
    const root = createRootRoute({
        component: () => (
            <FlowStatisticsView
                flow={flow}
                user={{ integralization: 42, period_max_workload: 420 }}
                semester="2026.2"
                manualCount={1}
                {...props}
            />
        )
    });
    const router = createRouter({ routeTree: root, history: createMemoryHistory() });
    await router.load();
    return dom.testing.render(<RouterProvider router={router} />);
}

test('resume o fluxo, a previsão e o que pode ser cursado', async () => {
    const page = await render();
    await page.findByText('4/10');
    const text = page.container.textContent;
    expect(text).toContain('40% das matérias');
    expect(text).toContain('360h obrigatórias restantes · 1 marcada por você');
    expect(text).toContain('3 semestres');
    expect(text).toContain('2028.1');
    expect(text).toContain('Limitado pela cadeia de pré-requisitos.');
    expect(page.getByRole('link', { name: /MAT0026/ }).getAttribute('href')).toContain('q=MAT0026');
    expect(text).toContain('Engenharia e Ambiente');
    expect(text).toContain('Integralização no SIGAA');
});

test('sem pendências, a previsão diz que tudo está concluído ou em curso', async () => {
    const page = await render({
        flow: {
            ...flow,
            overdue: [],
            remainingSemesters: 0,
            completed: { subjects: 8, hours: 480 }
        }
    });
    await page.findByText('Todas as obrigatórias concluídas ou em curso.');
    expect(page.queryByRole('region', { name: 'Atrasadas' })).toBeNull();
});
