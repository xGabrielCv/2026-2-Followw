import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC = join(import.meta.dir, '..', '.output', 'public');
const API_ENV = join(import.meta.dir, '..', '..', 'api', '.env');

function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? files(path) : [path];
    });
}

// Valores secretos reais da instância local (sem imprimir nada se achar).
function localSecrets(): string[] {
    if (!existsSync(API_ENV)) return [];
    return readFileSync(API_ENV, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.match(/^([A-Z0-9_]+)=(.+)$/))
        .filter(
            (m): m is RegExpMatchArray => !!m && /KEY|SECRET|PASSWORD|HASH|TOKEN|URL/.test(m[1])
        )
        .map((m) => m[2].trim().replace(/^['"]|['"]$/g, ''))
        .filter((value) => value.length >= 16);
}

const built = existsSync(PUBLIC);

describe.skipIf(!built)('artefatos públicos do build de produção', () => {
    const texts = built
        ? files(PUBLIC)
              .filter((path) => !/\.(png|jpe?g|webp|ico|woff2?|avif|gif)$/i.test(path))
              .map((path) => ({ path, text: readFileSync(path, 'utf8') }))
        : [];

    test('não publica source maps', () => {
        expect(files(PUBLIC).filter((path) => path.endsWith('.map'))).toEqual([]);
    });

    test('não carrega nomes de segredos do servidor', () => {
        const names = [
            'DATA_ENCRYPTION_KEY',
            'ADMIN_PASSWORD_HASH',
            'RATE_LIMIT_SECRET_KEY',
            'DATABASE_URL'
        ];
        const hits = texts.flatMap(({ path, text }) =>
            names.filter((name) => text.includes(name)).map((name) => `${path}:${name}`)
        );
        expect(hits).toEqual([]);
    });

    test('não carrega chaves privadas nem strings de conexão com senha', () => {
        const patterns = [
            /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
            /postgres(ql)?(\+\w+)?:\/\/[^\s"']+:[^\s"']+@/
        ];
        const hits = texts.filter(({ text }) => patterns.some((pattern) => pattern.test(text)));
        expect(hits.map(({ path }) => path)).toEqual([]);
    });

    test('não carrega valores secretos da instância local', () => {
        const secrets = localSecrets();
        const hits = texts.filter(({ text }) => secrets.some((secret) => text.includes(secret)));
        expect(hits.map(({ path }) => path)).toEqual([]);
    });
});
