import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Windows distingue PATH/Path nos subprocessos do Node; evita perder ferramentas instaladas pelo usuário.
const runtimePath = Object.entries(process.env)
    .filter(([name]) => name.toLowerCase() === 'path')
    .map(([, value]) => value)
    .filter(Boolean)
    .join(process.platform === 'win32' ? ';' : ':');

const database =
    (process.env.FOLLOWW_E2E_DATABASE ??= `followw_e2e_${randomUUID().replaceAll('-', '').slice(0, 12)}`);
const root = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
    testDir: './e2e',
    testMatch: '**/*.e2e.ts',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 90_000,
    outputDir: `${root}/.local/e2e-results`,
    reporter: [['list']],
    use: {
        baseURL: 'http://127.0.0.1:3011',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure'
    },
    webServer: [
        {
            command: 'uv run --no-sync python tests/e2e_server.py',
            cwd: fileURLToPath(new URL('../api/', import.meta.url)),
            url: 'http://127.0.0.1:8011/api/admin/api/session',
            reuseExistingServer: false,
            timeout: 60_000,
            env: {
                PATH: runtimePath,
                Path: runtimePath,
                ENVIRONMENT: 'testing',
                FOLLOWW_E2E_DATABASE: database,
                JWT_SECRET_KEY: 'chave-sintetica-exclusiva-de-e2e-cookies',
                DATA_ENCRYPTION_KEY: 'chave-sintetica-exclusiva-de-e2e-conteudo',
                DATA_ENCRYPTION_KEY_ID: 'e2e',
                DATA_ENCRYPTION_PREVIOUS_KEYS: '{}',
                ADMIN_USERNAME: '',
                ADMIN_PASSWORD_HASH: '',
                UPSTASH_REDIS_REST_URL: '',
                UPSTASH_REDIS_REST_TOKEN: '',
                DEMO_DATA: 'false',
                CORS_ORIGINS: '["http://127.0.0.1:3011","http://127.0.0.1:8011"]'
            }
        },
        {
            command: 'bun run dev --host 127.0.0.1 --port 3011',
            url: 'http://127.0.0.1:3011',
            reuseExistingServer: false,
            timeout: 60_000,
            env: { API_PORT: '8011', VITE_POSTHOG_KEY: '', PATH: runtimePath, Path: runtimePath }
        }
    ]
});
