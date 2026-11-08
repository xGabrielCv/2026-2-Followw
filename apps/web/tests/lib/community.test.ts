import { describe, expect, test } from 'bun:test';

import { attendanceSentence, mainAttendance } from '#/components/community/AttendanceSummary';
import { PROMPT_CHANCE, shouldPrompt } from '#/components/profile/SharePrompt';
import { campusOfUnit } from '#/lib/campus';
import { cleanGroups, validGroupUrl } from '#/lib/groups';
import { ratingLabel, ratingTone, reviewMonth } from '#/lib/reviews';

describe('grupos das turmas', () => {
    test('aceita só links https da plataforma escolhida', () => {
        expect(validGroupUrl('whatsapp', 'https://chat.whatsapp.com/AbC')).toBe(true);
        expect(validGroupUrl('telegram', ' https://t.me/+turma ')).toBe(true);
        expect(validGroupUrl('teams', 'https://teams.microsoft.com/l/team/x')).toBe(true);
        expect(validGroupUrl('aprender3', 'https://aprender3.unb.br/course/view.php?id=1')).toBe(
            true
        );

        expect(validGroupUrl('whatsapp', 'http://chat.whatsapp.com/AbC')).toBe(false);
        expect(validGroupUrl('whatsapp', 'https://t.me/+turma')).toBe(false);
        expect(validGroupUrl('teams', 'https://teams.microsoft.com.evil.com/x')).toBe(false);
        expect(validGroupUrl('telegram', 'não é link')).toBe(false);
    });

    test('a senha só fica no aprender 3 e os espaços somem', () => {
        expect(
            cleanGroups([
                { platform: 'whatsapp', url: ' https://chat.whatsapp.com/a ', password: 'x' },
                { platform: 'aprender3', url: 'https://aprender3.unb.br/1', password: ' chave ' },
                { platform: 'aprender3', url: 'https://aprender3.unb.br/2', password: '  ' }
            ])
        ).toEqual([
            { platform: 'whatsapp', url: 'https://chat.whatsapp.com/a', password: null },
            { platform: 'aprender3', url: 'https://aprender3.unb.br/1', password: 'chave' },
            { platform: 'aprender3', url: 'https://aprender3.unb.br/2', password: null }
        ]);
    });

    test('campus pela unidade do curso', () => {
        expect(campusOfUnit(673)).toBe('gama');
        expect(campusOfUnit(672)).toBe('ceilandia');
        expect(campusOfUnit(666)).toBe('planaltina');
        expect(campusOfUnit(508)).toBe('darcy');
        expect(campusOfUnit(null)).toBeUndefined();
    });
});

describe('avaliações de docentes', () => {
    test('rótulo e cor da nota', () => {
        expect(ratingLabel(95)).toBe('excelente');
        expect(ratingLabel(70)).toBe('boa');
        expect(ratingLabel(40)).toBe('regular');
        expect(ratingLabel(10)).toBe('ruim');
        expect(ratingTone(80)).toBe('text-primary');
        expect(ratingTone(50)).toBe('text-warning');
        expect(ratingTone(0)).toBe('text-destructive');
    });

    test('mostra só o mês da avaliação', () => {
        expect(reviewMonth('2026-11')).toContain('2026');
        expect(reviewMonth('2026-11')).toMatch(/nov/);
    });
});

describe('chamada e convite para compartilhar', () => {
    test('a chamada mais respondida vira o rótulo; empate não', () => {
        expect(mainAttendance({ cobra: 3, nao_cobra: 1, varia: 0 })).toBe('cobra');
        expect(attendanceSentence({ cobra: 0, nao_cobra: 2, varia: 1 })).toBe('Não cobra chamada');
        expect(mainAttendance({ cobra: 2, nao_cobra: 2, varia: 0 })).toBeNull();
        expect(mainAttendance({ cobra: 0, nao_cobra: 0, varia: 0 })).toBeNull();
    });

    test('o convite aparece na primeira vez e depois ao acaso, uma vez por sessão', () => {
        expect(shouldPrompt(false, false, 0.99)).toBe(true);
        expect(shouldPrompt(true, false, PROMPT_CHANCE - 0.01)).toBe(true);
        expect(shouldPrompt(true, false, PROMPT_CHANCE + 0.01)).toBe(false);
        expect(shouldPrompt(false, true, 0)).toBe(false);
    });
});
