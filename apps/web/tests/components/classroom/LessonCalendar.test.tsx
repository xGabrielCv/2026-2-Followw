import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { Lesson } from '#/queries/classrooms';

import { LessonCalendar, lessonsByDay } from '#/components/classroom/LessonCalendar';

import { useDom } from '../../helpers/dom';

const dom = useDom();
const lesson = (day: string, status: Lesson['status'], start = '08:00'): Lesson => ({
    id: `${day}:${start}`,
    occurred_on: day,
    start_time: start,
    end_time: '09:50',
    status,
    absences: status === 'falta' ? 2 : 0,
    marked: false
});
const lessons = [
    lesson('2026-10-09', 'cancelada'),
    lesson('2026-10-05', 'falta', '10:00'),
    lesson('2026-10-05', 'presente')
];

test('agrupa chamadas por dia e horário sem modificar os dados pessoais', () => {
    const before = structuredClone(lessons);
    const days = lessonsByDay(lessons);
    expect([...days.keys()]).toEqual(['2026-10-05', '2026-10-09']);
    expect(days.get('2026-10-05')?.map((item) => item.status)).toEqual(['presente', 'falta']);
    expect(lessons).toEqual(before);
});

test('seleciona o dia e permite voltar a todas as aulas', () => {
    const picks: (string | null)[] = [];
    const view = dom.testing.render(
        <LessonCalendar
            lessons={lessons}
            selected={null}
            onSelect={(date) => {
                picks.push(date);
            }}
        />
    );
    dom.testing.fireEvent.click(view.getByRole('button', { name: '05/10/2026: Presença, Falta' }));
    expect(picks).toEqual(['2026-10-05']);
    view.rerender(
        <LessonCalendar
            lessons={lessons}
            selected={picks.at(-1) ?? null}
            onSelect={(date) => {
                picks.push(date);
            }}
        />
    );
    dom.testing.fireEvent.click(view.getByRole('button', { name: 'Mostrar todas as aulas' }));
    expect(picks).toEqual(['2026-10-05', null]);
});

test('preserva identificação de cancelamento e horários no calendário', () => {
    const html = renderToStaticMarkup(
        <LessonCalendar lessons={lessons} selected={null} onSelect={() => {}} />
    );
    expect(html).toContain('line-through');
    expect(html).toContain('09/10/2026: Cancelada');
    expect(html).toContain('bg-primary');
    expect(html).toContain('bg-destructive');
});
