import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, test } from 'bun:test';

import type { AppConfig } from '#/queries/app-config';

import { SystemNoticeBanner } from '#/components/SystemNoticeBanner';
import { appConfigQueryOptions } from '#/queries/app-config';

import { useDom } from '../helpers/dom';

const baseConfig: AppConfig = {
    menu: {},
    links: { automatricula: null, monitor: null },
    flags: {},
    calendar: {},
    alert: {
        enabled: true,
        always_on: false,
        preset: 'custom',
        title: 'Avalie seus professores do semestre',
        message: 'Ajude os próximos alunos.',
        mid_semester_enabled: true,
        mid_semester_every_n: 3,
        mid_semester_title: '50% do semestre: avalie seus professores',
        mid_semester_message: 'Como estão as aulas?',
        last_day_enabled: true,
        last_day_title: 'Último dia do semestre: avalie seus professores',
        last_day_message: 'Hoje encerra o semestre letivo.',
        first_day_enabled: true,
        first_day_title: 'Avalie seus professores do semestre anterior',
        first_day_message: 'Avalie suas turmas do semestre passado.',
        trigger_id: 'default',
        triggered_at: null
    },
    banner: null
};

describe('SystemNoticeBanner', () => {
    const dom = useDom();

    beforeEach(() => {
        window.sessionStorage.clear();
    });

    function renderBanner(banner: AppConfig['banner']) {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        client.setQueryData(appConfigQueryOptions.queryKey, { ...baseConfig, banner });
        return dom.testing.render(
            <QueryClientProvider client={client}>
                <SystemNoticeBanner />
            </QueryClientProvider>
        );
    }

    test('omite o bloco quando não há aviso ativo', () => {
        const view = renderBanner(null);
        expect(view.queryByRole('complementary', { name: 'Aviso operacional' })).toBeNull();
    });

    test('exibe aviso operacional, permite dispensar na sessão e reexibe quando o id muda', () => {
        const first = renderBanner({
            id: 'aviso-1',
            level: 'warning',
            title: 'SIGAA instável',
            message: 'A UnB apresenta lentidão temporária.',
            expires_at: null
        });

        const region = first.getByRole('complementary', { name: 'Aviso operacional' });
        expect(region.textContent).toContain('SIGAA instável');
        expect(region.textContent).toContain('A UnB apresenta lentidão temporária.');

        dom.testing.fireEvent.click(first.getByRole('button', { name: 'Dispensar aviso' }));
        expect(first.queryByRole('complementary', { name: 'Aviso operacional' })).toBeNull();
        expect(window.sessionStorage.getItem('followw:dismissed-banner')).toBe('aviso-1');
        first.unmount();

        const sameId = renderBanner({
            id: 'aviso-1',
            level: 'warning',
            title: 'SIGAA instável',
            message: 'A UnB apresenta lentidão temporária.',
            expires_at: null
        });
        expect(sameId.queryByRole('complementary', { name: 'Aviso operacional' })).toBeNull();
        sameId.unmount();

        const newId = renderBanner({
            id: 'aviso-2',
            level: 'info',
            title: 'Catálogo atualizado',
            message: 'Ofertas sincronizadas.',
            expires_at: null
        });
        expect(
            newId.getByRole('complementary', { name: 'Aviso operacional' }).textContent
        ).toContain('Catálogo atualizado');
    });
});
