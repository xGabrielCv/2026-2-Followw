import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export default function teardown() {
    if (process.env.FOLLOWW_E2E_OWNS_DATABASE !== '1') return;
    execFileSync('uv', ['run', '--no-sync', 'python', 'tests/e2e_cleanup.py'], {
        cwd: fileURLToPath(new URL('../../api/', import.meta.url)),
        stdio: 'inherit'
    });
}
