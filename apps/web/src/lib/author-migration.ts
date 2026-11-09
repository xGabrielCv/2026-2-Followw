import { applyMigration, legacySecret } from '#/lib/author';
import { apiClient } from '#/queries/client';

let running = false;

/**
 * Migração única da autoria antiga: manda o segredo antigo (uma vez), recebe uma chave nova e
 * independente por publicação e descarta o segredo. Se falhar, o segredo antigo fica e tenta de novo na
 * próxima abertura; nada é perdido. O servidor só acha as linhas que esse segredo reconhece.
 */
export async function migrateLegacyAuthorship(): Promise<'migrated' | 'nothing' | 'failed'> {
    const secret = legacySecret();
    if (!secret || running) return 'nothing';
    running = true;
    try {
        const { data } = await apiClient.POST('/community/migrate', {
            headers: { 'X-Followw-Author': secret }
        });
        if (!data) return 'failed';
        const keys: Record<string, string> = {};
        for (const item of data.items) keys[`${item.kind}:${item.id}`] = item.key;
        for (const [classroom, key] of Object.entries(data.statistics))
            keys[`share:${classroom}`] = key;
        applyMigration(keys);
        return 'migrated';
    } catch {
        return 'failed';
    } finally {
        running = false;
    }
}
