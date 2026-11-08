import type { GroupLink, GroupPlatform } from '#/queries/groups';

export const MAX_GROUPS = 3;

export const PLATFORMS: GroupPlatform[] = ['whatsapp', 'telegram', 'teams', 'aprender3'];

export const PLATFORM_LABELS: Record<GroupPlatform, string> = {
    whatsapp: 'WhatsApp',
    telegram: 'Telegram',
    teams: 'Teams',
    aprender3: 'Aprender 3'
};

// os mesmos domínios que a API aceita
const HOSTS: Record<GroupPlatform, string[]> = {
    whatsapp: ['chat.whatsapp.com'],
    telegram: ['t.me', 'telegram.me'],
    teams: ['teams.microsoft.com', 'teams.live.com'],
    aprender3: ['aprender3.unb.br']
};

export const PLATFORM_EXAMPLES: Record<GroupPlatform, string> = {
    whatsapp: 'https://chat.whatsapp.com/...',
    telegram: 'https://t.me/...',
    teams: 'https://teams.microsoft.com/...',
    aprender3: 'https://aprender3.unb.br/course/view.php?id=...'
};

/** O link é https e da plataforma escolhida, como a API exige. */
export function validGroupUrl(platform: GroupPlatform, value: string): boolean {
    try {
        const url = new URL(value.trim());
        const host = url.hostname.toLowerCase();
        return (
            url.protocol === 'https:' &&
            HOSTS[platform].some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
        );
    } catch {
        return false;
    }
}

/** Os grupos prontos para salvar; a senha só vale no Aprender 3. */
export const cleanGroups = (groups: GroupLink[]): GroupLink[] =>
    groups.map(({ platform, url, password }) => ({
        platform,
        url: url.trim(),
        password: platform === 'aprender3' && password?.trim() ? password.trim() : null
    }));
