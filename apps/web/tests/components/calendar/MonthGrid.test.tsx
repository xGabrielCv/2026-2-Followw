import { afterEach, expect, test } from 'bun:test';

import type { DayMarks } from '#/components/calendar/MonthGrid';

import { MonthGrid } from '#/components/calendar/MonthGrid';
import { academicEventsOn } from '#/lib/agenda';

import { useDom } from '../../helpers/dom';

const dom = useDom();
afterEach(() => dom.testing.cleanup());

const marks = (date: string): DayMarks => ({
    academic: academicEventsOn(date),
    entries:
        date === '2026-11-20'
            ? [
                  {
                      id: '1',
                      date,
                      title: 'Prova 2',
                      kind: 'prova',
                      time: null,
                      subject_code: null,
                      notes: null,
                      remind_days: null
                  }
              ]
            : []
});

function render(calls: { selected: string[]; months: number[] }, month = '2026-11') {
    return dom.testing.render(
        <MonthGrid
            month={month}
            selected="2026-11-09"
            today="2026-11-07"
            marks={marks}
            onSelect={(date) => calls.selected.push(date)}
            onMonth={(step) => calls.months.push(step)}
        />
    );
}

test('mostra o mês com os lançamentos, sem marcar as aulas', () => {
    const page = render({ selected: [], months: [] });
    expect(page.getByRole('heading', { name: 'Novembro de 2026' })).toBeDefined();
    expect(page.getByRole('button', { name: /^20: 1 lançamentos/ }).textContent).toContain(
        'Prova 2'
    );
    const monday = page.getByRole('button', { name: '9' });
    expect(monday.getAttribute('aria-pressed')).toBe('true');
    // aulas só aparecem ao abrir o dia: a grade do mês fica limpa
    expect(monday.querySelectorAll('span')).toHaveLength(1);
});

test('feriados da UnB aparecem no dia', () => {
    const page = render({ selected: [], months: [] }, '2026-10');
    const day = page.getByRole('button', { name: /^12:.*Nossa Senhora Aparecida/ });
    expect(day.textContent).toContain('Nossa Senhora Aparecida');
});

test('clicar no dia o escolhe e as setas trocam o mês', () => {
    const calls = { selected: [] as string[], months: [] as number[] };
    const page = render(calls);
    const { fireEvent } = dom.testing;
    fireEvent.click(page.getByRole('button', { name: /^20: 1 lançamentos/ }));
    fireEvent.click(page.getByRole('button', { name: 'Próximo mês' }));
    fireEvent.click(page.getByRole('button', { name: 'Mês anterior' }));
    expect(calls).toEqual({ selected: ['2026-11-20'], months: [1, -1] });
});
