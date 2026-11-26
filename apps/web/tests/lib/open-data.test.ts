import { describe, expect, test } from 'bun:test';

import { safeCsvCell, serializeOpenData } from '#/lib/open-data';

describe('exportação em dados abertos', () => {
    test('neutraliza fórmulas perigosas em células CSV e escapa aspas', () => {
        expect(safeCsvCell('=CMD("calc")')).toBe(`"'=CMD(""calc"")"`);
        expect(safeCsvCell(' +SUM(A1:A2)')).toBe(`"' +SUM(A1:A2)"`);
        expect(safeCsvCell('@HYPERLINK("http://x")')).toBe(`"'@HYPERLINK(""http://x"")"`);
        expect(safeCsvCell('FGA0146')).toBe('"FGA0146"');
    });

    test('serializa CSV com BOM UTF-8 e JSON formatado sem perda de colunas', () => {
        const rows = [
            { codigo: 'FGA0146', disciplina: 'Estruturas de Dados 1', aprovacao_pct: 72.5 }
        ];
        const csv = serializeOpenData(rows, 'csv');
        expect(csv.mime).toContain('text/csv');
        expect(csv.content.startsWith('\uFEFF')).toBe(true);
        expect(csv.content).toContain('"codigo","disciplina","aprovacao_pct"');
        expect(csv.content).toContain('"FGA0146","Estruturas de Dados 1","72.5"');

        const json = serializeOpenData(rows, 'json');
        expect(json.mime).toContain('application/json');
        expect(JSON.parse(json.content)).toEqual(rows);
    });
});
