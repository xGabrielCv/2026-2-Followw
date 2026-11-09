import {
    createMemoryHistory,
    createRootRoute,
    createRouter,
    RouterProvider
} from '@tanstack/react-router';
import { afterEach, expect, test } from 'bun:test';

import type { Classroom } from '#/queries/classrooms';
import type { CalendarEntry } from '#/queries/events';

import { DayAgenda } from '#/components/home/DayAgenda';
import { subjectPalette } from '#/lib/agenda';
import { classesOn } from '#/lib/schedule';

import { useDom } from '../../helpers/dom';

const dom = useDom();
afterEach(() => dom.testing.cleanup());

const classroom = (code: string, name: string, schedule: string, room: string): Classroom => ({
    id: code,
    subject: { code, name, hours: 60 },
    status: 'cursando',
    grade: null,
    current: true,
    number: '01',
    semester: '2026.2',
    schedule,
    room,
    professors: []
});

const classrooms = [
    classroom('FGA0124', 'PROJETO DE ALGORITMOS', '2M34', 'SALA S3'),
    classroom('FGA0030', 'ESTRUTURAS DE DADOS 2', '2M12', 'SALA MOCAP (AUDITÓRIO)')
];
const prova: CalendarEntry = {
    id: '1',
    date: '2026-11-09',
    title: 'Prova 2 de EDA',
    kind: 'prova',
    time: '08:00:00',
    subject_code: 'FGA0030',
    notes: null,
    remind_days: 3
};

async function render(selected: string[], loggedIn = true) {
    const root = createRootRoute({
        component: () => (
            <DayAgenda
                date="2026-11-09"
                today="2026-11-07"
                onSelect={(date) => selected.push(date)}
                loggedIn={loggedIn}
                isLoadingError={false}
                onRetry={() => {}}
                classes={classesOn(classrooms, 1)}
                entries={[prova]}
                colorOf={subjectPalette(classrooms.map((item) => item.subject.code))}
            />
        )
    });
    const router = createRouter({ routeTree: root, history: createMemoryHistory() });
    await router.load();
    return dom.testing.render(<RouterProvider router={router} />);
}

test('mostra as aulas do dia em ordem, com horário e sala, e os lançamentos do dia', async () => {
    const page = await render([]);
    const cards = await page.findAllByRole('button', { name: /às/ });
    expect(cards.map((card) => card.getAttribute('aria-label'))).toEqual([
        'ESTRUTURAS DE DADOS 2, 8:00 às 9:50',
        'PROJETO DE ALGORITMOS, 10:00 às 11:50'
    ]);
    expect(cards[0].textContent).toContain('SALA MOCAP (AUDITÓRIO)');
    expect(cards[0].className).not.toBe(cards[1].className);
    expect(page.getByText('Prova 2 de EDA')).toBeDefined();
    // 10 min entre as aulas não chega a ser intervalo
    expect(page.queryByText(/Intervalo/)).toBeNull();
});

test('as setas e a semana trocam o dia, e Hoje volta para a data atual', async () => {
    const selected: string[] = [];
    const page = await render(selected);
    const { fireEvent } = dom.testing;
    fireEvent.click(await page.findByRole('button', { name: 'Dia anterior' }));
    fireEvent.click(page.getByRole('button', { name: 'Próximo dia' }));
    fireEvent.click(page.getByRole('button', { name: 'Hoje' }));
    fireEvent.click(page.getByRole('button', { name: 'Q11: quarta-feira, 11 de novembro' }));
    expect(selected).toEqual(['2026-11-08', '2026-11-10', '2026-11-07', '2026-11-11']);
    expect(
        page
            .getByRole('button', { name: 'S9: segunda-feira, 9 de novembro' })
            .getAttribute('aria-pressed')
    ).toBe('true');
});

test('sem login pede para entrar com o SIGAA', async () => {
    const page = await render([], false);
    expect(await page.findByText(/Matrícula UnB/)).toBeDefined();
});

test('nome acessível do dia contém o rótulo visível para comando de voz', async () => {
    const page = await render([]);
    const selected = await page.findByRole('button', { pressed: true });
    const visible = selected.textContent.replace(/\s+/g, ' ').trim();
    expect(selected.getAttribute('aria-label')!.startsWith(visible)).toBe(true);
});
