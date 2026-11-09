import { afterEach, describe, expect, test } from 'bun:test';

import { setAuthorSecret } from '#/lib/author';
import { backupSummary, exportBackup, importBackup, parseBackup } from '#/lib/backup';
import { marksStore } from '#/lib/lesson-marks';
import { schedulePlans } from '#/lib/planned-schedule';
import { entriesStore } from '#/queries/events';
import { ownReviews } from '#/queries/reviews';
import { settingsStore } from '#/queries/settings';

const REG = '251000000';

afterEach(() => {
    settingsStore(REG).clear();
    entriesStore(REG).clear();
    marksStore(REG).clear();
    schedulePlans.clear();
    ownReviews.clear();
});

describe('backup do que fica só no aparelho', () => {
    test('exportação nova não leva segredos nem campos desconhecidos das configurações', () => {
        setAuthorSecret('a'.repeat(64));
        ownReviews.set({
            p: {
                id: '00000000-0000-4000-8000-000000000001',
                token: 'segredo-de-avaliacao',
                rating: 4
            }
        });
        const settings = {
            displayName: 'Ana',
            password: 'senha-sintetica',
            token: 'token-sintetico'
        };
        settingsStore(REG).set(settings);
        const backup = exportBackup(REG);
        const text = JSON.stringify(backup);
        expect(backup.version).toBe(2);
        for (const secret of [
            'a'.repeat(64),
            'segredo-de-avaliacao',
            'senha-sintetica',
            'token-sintetico'
        ])
            expect(text).not.toContain(secret);
    });
    test('exporta e importa configurações, calendário, marcações, grades e avaliações', () => {
        settingsStore(REG).set({ displayName: 'Ana', completedSubjects: ['FGA0146'] });
        entriesStore(REG).set([
            {
                id: 'e1',
                date: '2026-11-20',
                time: '14:00',
                title: 'Prova 2',
                kind: 'prova',
                subject_code: 'FGA0030',
                notes: null,
                remind_days: 2
            }
        ]);
        marksStore(REG).set({ T1: { aula1: 'falta' } });
        const backup = exportBackup(REG, new Date('2026-11-08T12:00:00Z'));
        const text = JSON.stringify(backup);

        settingsStore(REG).clear();
        entriesStore(REG).clear();
        marksStore(REG).clear();
        const parsed = parseBackup(text);
        if (typeof parsed === 'string') throw new Error(parsed);
        importBackup(REG, parsed);

        expect(settingsStore(REG).getSnapshot().displayName).toBe('Ana');
        expect(entriesStore(REG).getSnapshot()[0]?.title).toBe('Prova 2');
        expect(marksStore(REG).getSnapshot()).toEqual({ T1: { aula1: 'falta' } });
        expect(backupSummary(parsed)[0]).toBe('1 lançamentos no calendário');
    });

    test('recusa arquivo que não é do Followw ou foi adulterado, sem gravar nada', () => {
        const valid = exportBackup(REG);
        expect(parseBackup('não é json')).toBe('json-invalido');
        expect(parseBackup('{"app":"outro"}')).toBe('nao-e-do-followw');
        expect(parseBackup(JSON.stringify({ ...valid, version: 9 }))).toBe('versao-desconhecida');
        for (const broken of [
            { ...valid, marks: { T1: { a: 'hack' } } },
            { ...valid, settings: { displayName: 'x'.repeat(200) } },
            { ...valid, settings: { completedSubjects: ['<script>'] } },
            { ...valid, events: [{ id: 'e', title: '', date: 'ontem', kind: 'prova' }] },
            { ...valid, plans: { active: 'a', plans: [] } },
            { ...valid, reviews: { x: { id: 'nao-uuid', token: 't', rating: 1 } } }
        ])
            expect(parseBackup(JSON.stringify(broken))).toBe('conteudo-invalido');
        expect(parseBackup('x'.repeat(3 * 1024 * 1024))).toBe('grande-demais');
    });
});
