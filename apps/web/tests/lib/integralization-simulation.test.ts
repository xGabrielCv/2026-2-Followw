import { expect, test } from 'bun:test';

import type { Classroom } from '#/queries/classrooms';

import { integralizationSubjects, simulateIntegralization } from '#/lib/integralization-simulation';

const user = {
    integralization: 50,
    workload: {
        total: 1000,
        pending_mandatory: 300,
        pending_optional: 100,
        pending_complementary: 100
    }
};
const item = (code: string, hours = 60): Classroom => ({
    id: code,
    number: '01',
    semester: '2032.2',
    current: true,
    status: 'cursando',
    subject: { code, name: code, hours, kind: 'mandatory' },
    professors: []
});

test('aprovação soma horas, reprovação e trancamento mantêm integralização atual', () => {
    const items = [item('A'), item('B'), item('C')];
    const result = simulateIntegralization(user, items, {
        A: { outcome: 'approved', category: 'mandatory' },
        B: { outcome: 'failed', category: 'mandatory' },
        C: { outcome: 'withdrawn', category: 'mandatory' }
    });
    expect(result).toMatchObject({ current: 50, future: 56, added: 60 });
});
test('limita cada categoria à pendência, exclui módulo livre e não ultrapassa cem', () => {
    const result = simulateIntegralization(
        user,
        [item('A', 600), item('B', 200), item('C', 200), item('D', 100)],
        {
            A: { outcome: 'approved', category: 'mandatory' },
            B: { outcome: 'approved', category: 'optional' },
            C: { outcome: 'approved', category: 'complementary' },
            D: { outcome: 'approved', category: 'free' }
        }
    );
    expect(result).toMatchObject({
        future: 100,
        added: 500,
        credited: { mandatory: 300, optional: 100, complementary: 100 }
    });
});
test('não soma duas turmas da mesma disciplina e informa aprovação sem carga ou categoria', () => {
    expect(
        simulateIntegralization(user, [item('A'), item('A')], {
            A: { outcome: 'approved', category: 'mandatory' }
        })?.added
    ).toBe(60);
    expect(
        simulateIntegralization(user, [item('A'), item('B', NaN)], {
            A: { outcome: 'approved', category: 'unknown' },
            B: { outcome: 'approved', category: 'mandatory' }
        })
    ).toMatchObject({ future: 50, uncertain: ['A', 'B'] });
});
test('seleciona só disciplinas atuais no semestre escolhido e exclui as já aprovadas', () => {
    const a = item('A');
    const b = item('B');
    expect(
        integralizationSubjects(
            [
                a,
                a,
                b,
                { ...b, current: false, semester: '2032.1', grade: 'MS' },
                { ...item('C'), semester: '2033.1' }
            ],
            '2032.2'
        ).map((i) => i.subject.code)
    ).toEqual(['A']);
});
test('sem carga válida não inventa percentual e sem percentual usa horas oficiais', () => {
    expect(simulateIntegralization({ ...user, workload: null }, [], {})).toBeNull();
    expect(
        simulateIntegralization({ ...user, workload: { ...user.workload, total: 0 } }, [], {})
    ).toBeNull();
    expect(simulateIntegralization({ ...user, integralization: null }, [], {})?.current).toBe(50);
});
