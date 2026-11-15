import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { WeeklySchedule } from '#/components/schedule/WeeklySchedule';

import { useDom } from '../../helpers/dom';

const dom = useDom();
const entries = [
    { key: 'a', code: 'MAT0001', name: 'Cálculo', number: '01', schedule: '2M12' },
    { key: 'b', code: 'FGA0002', name: 'Projeto', number: '02', schedule: '7N4' },
    { key: 'c', code: 'SEM001', name: 'Sem horário', number: '01', schedule: null }
];

test('grade preserva horários noturnos, sábado e matérias sem horário', () => {
    const html = renderToStaticMarkup(<WeeklySchedule entries={entries} label="Grade semanal" />);
    expect(html).toContain('22:30');
    expect(html).toContain('Sáb');
    expect(html).toContain('SEM001');
    expect(html).toContain('horário a definir');
});

test('abrir bloco semanal encaminha o identificador da turma', () => {
    const opened: string[] = [];
    const view = dom.testing.render(
        <WeeklySchedule
            entries={entries}
            label="Grade semanal"
            onSelect={(id) => opened.push(id)}
        />
    );
    dom.testing.fireEvent.click(
        view.getByRole('button', { name: 'Seg, 08:00–09:50: Cálculo, MAT0001, turma 01' })
    );
    expect(opened).toEqual(['a']);
});
