import { describe, expect, test } from 'bun:test';

import type { Classroom } from '#/queries/classrooms';

import { projectedCategoryHours } from '#/lib/profile';
function classroom(
    code: string,
    hours: number | null = 60,
    kind: Classroom['subject']['kind'] = null
): Classroom {
    return {
        id: code,
        number: '01',
        semester: '2026.2',
        current: true,
        status: 'cursando',
        subject: { code, name: code, hours, kind },
        professors: []
    };
}

describe('projectedCategoryHours', () => {
    test('soma as horas das disciplinas atuais por tipo na matriz', () => {
        expect(
            projectedCategoryHours([
                classroom('A', 60, 'mandatory'),
                classroom('B', 90, 'mandatory'),
                classroom('C', 30, 'optional')
            ])
        ).toEqual({ mandatory: 150, optional: 30 });
    });

    test('ignora módulo livre e disciplinas sem tipo conhecido', () => {
        expect(
            projectedCategoryHours([classroom('LIVRE', 60, 'free'), classroom('SEM', 60, null)])
        ).toEqual({ mandatory: 0, optional: 0 });
    });

    test('aplica os mesmos filtros da previsão de integralização', () => {
        expect(
            projectedCategoryHours([
                classroom('A', 60, 'mandatory'),
                { ...classroom('A', 60, 'mandatory'), id: 'outra' },
                { ...classroom('ANTIGA', 60, 'mandatory'), current: false },
                { ...classroom('TRANCADA', 60, 'optional'), status: 'trancado' },
                classroom('SEM_CARGA', null, 'optional')
            ])
        ).toEqual({ mandatory: 60, optional: 0 });
    });
});
