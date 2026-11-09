import { describe, expect, test } from 'bun:test';

import type { Classroom } from '#/queries/classrooms';
import type { Comparison } from '#/queries/comparison';
import type { InternshipItem } from '#/queries/internships';

import { keyFor, newKey, validAuthor } from '#/lib/author';
import { difference, insights, myApprovalRate, myResults } from '#/lib/comparison';
import { countdown } from '#/lib/countdown';
import { filterInternships, lookupText } from '#/lib/internships';
import { menuVisible } from '#/queries/app-config';

function turma(code: string, semester: string, grade: string | null, current = false) {
    const item = {
        id: `${code}-${semester}`,
        number: '01',
        semester,
        current,
        grade,
        status: current ? 'cursando' : 'concluido',
        professors: [],
        subject: { code, name: code }
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- turma parcial de teste
    return item as unknown as Classroom;
}

const rate = (code: string, failed: number) => ({
    code,
    name: code,
    rates: { classrooms: 3, approved: 100 - failed, failed, dropped: 0 }
});

describe('estatísticas comparadas, no aparelho', () => {
    const history = [
        turma('A', '2025.1', 'MI'),
        turma('A', '2025.2', 'MS'),
        turma('B', '2025.2', 'SS'),
        turma('C', '2026.2', null, true)
    ];
    const data: Comparison = {
        unb: { classrooms: 10, approved: 70, failed: 25, dropped: 5 },
        course: { classrooms: 4, approved: 60, failed: 35, dropped: 5 },
        subjects: [rate('A', 40), rate('B', 10), rate('D', 50), rate('C', 30)]
    };

    test('a última tentativa vale e cada tentativa conta na aprovação', () => {
        const mine = myResults(history);
        expect([...mine.approved].toSorted()).toEqual(['A', 'B']);
        expect(mine.failed.size).toBe(0);
        expect(myApprovalRate(history)).toBe(66.7);
        expect(myApprovalRate([])).toBeNull();
    });

    test('compara com as mesmas matérias e aponta as difíceis que faltam', () => {
        const result = insights(history, data, 'course');
        expect(result.sameSubjectsRate).toBe(75);
        expect(result.myDifficulty).toBe(25);
        expect(result.scopeDifficulty).toBe(35);
        expect(result.hardestPassed.map((item) => item.code)).toEqual(['A', 'B']);
        // C está sendo cursada: não entra entre as que faltam
        expect(result.hardestAhead.map((item) => item.code)).toEqual(['D']);
        expect(insights(history, data, 'unb').scopeDifficulty).toBe(25);
        expect(difference(66.7, 75)).toBe('8,3 pontos abaixo da média');
        expect(difference(75.2, 75)).toBe('igual à média');
        expect(difference(null, 75)).toBeNull();
    });
});

describe('agenda do dia', () => {
    test('mostra quanto falta para acabar ou para começar', () => {
        expect(countdown('in_progress', '14:00', '15:50', '15:15')).toBe('termina em 35 min');
        expect(countdown('next', '16:00', '17:50', '14:50')).toBe('começa em 1h10');
        expect(countdown('normal', '16:00', '17:50', '14:50')).toBeNull();
        expect(countdown('in_progress', '14:00', '15:50', '15:50')).toBeNull();
    });
});

function vaga(title: string, mine: boolean, stipend: string | null, until: string): InternshipItem {
    return {
        reference: `${mine ? 'listagem_meu_curso' : 'listagem_outros_cursos'}:${title}`,
        title,
        vacancies: 1,
        stipend,
        published_until: until,
        mine
    };
}

describe('estágios', () => {
    const items = [
        vaga('Estágio em Programação', true, '1500.00', '2026-12-10T18:00:00'),
        vaga('Estágio jurídico', false, null, '2026-11-30T18:00:00'),
        vaga('Estágio antigo', true, '900.00', '2026-10-01T18:00:00'),
        vaga('Estágio em Programação', false, '1500.00', '2026-12-10T18:00:00')
    ];
    const now = new Date('2026-11-08T12:00:00');
    const titles = (filters: Partial<Parameters<typeof filterInternships>[1]>) =>
        filterInternships(
            items,
            { q: '', scope: 'all', order: 'closing', bolsa: false, ...filters },
            now
        ).map((item) => item.title);

    test('filtra encerradas, curso, bolsa e busca sem acento, sem repetir', () => {
        expect(titles({})).toEqual(['Estágio jurídico', 'Estágio em Programação']);
        expect(titles({ scope: 'mine' })).toEqual(['Estágio em Programação']);
        expect(titles({ bolsa: true })).toEqual(['Estágio em Programação']);
        expect(titles({ q: 'programacao' })).toEqual(['Estágio em Programação']);
        expect(titles({ order: 'stipend' })[0]).toBe('Estágio em Programação');
        expect(lookupText('  Programação  ')).toBe('programacao');
    });
});

describe('menu Mais controlado pelo admin', () => {
    test('sem configuração, as ferramentas ficam escondidas e o resto aparece', () => {
        expect(menuVisible(undefined, 'automatricula')).toBe(false);
        expect(menuVisible(undefined, 'grupos')).toBe(true);
        const config = {
            menu: { automatricula: true, grupos: false },
            links: { automatricula: 'https://x', monitor: null }
        };
        expect(menuVisible(config, 'automatricula')).toBe(true);
        expect(menuVisible(config, 'grupos')).toBe(false);
    });
});

describe('chaves de autoria', () => {
    test('formato validado, chave nova aleatória e nada guardado no SSR', () => {
        expect(validAuthor('a'.repeat(64))).toBe(true);
        expect(validAuthor('251000000')).toBe(false);
        expect(validAuthor(newKey())).toBe(true);
        expect(keyFor('post', 'qualquer')).toBeUndefined();
    });
});
