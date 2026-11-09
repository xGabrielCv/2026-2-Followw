import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { DEFAULT_RETENTION_DAYS, RETENTION_DAYS } from '#/lib/local-vault';

// Contrato das regras inegociáveis (docs-interno/docs/projeto/regras-inegociaveis.md).
const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('R-ARM-03 retenção local', () => {
    test('oferece 7, 30, 90 e 400 dias com padrão de 30', () => {
        expect([...RETENTION_DAYS]).toEqual([7, 30, 90, 400]);
        expect(DEFAULT_RETENTION_DAYS).toBe(30);
    });
});

describe('R-INT-04 aba Mais', () => {
    const mais = source('src/routes/_app/mais.tsx');
    const groups = [...mais.matchAll(/<MenuGroup title="([^"]+)"/g)].map((match) => match[1]);

    test('Ajuda é o último grupo', () => {
        expect(groups.at(-1)).toBe('Ajuda');
        expect(groups.filter((title) => title === 'Ajuda')).toHaveLength(1);
    });

    test('Ajuda usa o ícone de interrogação em vermelho', () => {
        const ajuda = mais.slice(mais.indexOf('<MenuGroup title="Ajuda">'));
        expect(ajuda).toContain('<CircleHelp');
        expect(ajuda).toContain('text-destructive');
    });
});

describe('R-ARM-02 chave do aparelho', () => {
    test('é AES-GCM de 256 bits e não exportável', () => {
        expect(source('src/lib/local-vault.ts')).toContain(
            "generateKey({ name: 'AES-GCM', length: 256 }, false"
        );
    });
});
