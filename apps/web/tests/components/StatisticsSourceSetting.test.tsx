import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, test } from 'bun:test';

import { StatisticsSourceSetting } from '#/components/profile/StatisticsSourceSetting';
import { readStatisticsSource, saveStatisticsSource } from '#/lib/statistics-source';

import { useDom } from '../helpers/dom';

const dom = useDom();

afterEach(() => {
    saveStatisticsSource('average');
    dom.testing.cleanup();
});

test('mostra linha compacta com a fonte ativa e abre diálogo ao clicar', async () => {
    const client = new QueryClient();
    const page = dom.testing.render(
        <QueryClientProvider client={client}>
            <StatisticsSourceSetting />
        </QueryClientProvider>
    );
    const trigger = page.getByRole('button', { name: /Fonte das estatísticas públicas/ });
    expect(trigger.textContent).toContain('Média combinada');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    dom.testing.fireEvent.click(trigger);
    await dom.testing.waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('true'));

    dom.testing.act(() => {
        saveStatisticsSource('tamburetei');
    });
    expect(readStatisticsSource()).toBe('tamburetei');
    await dom.testing.waitFor(() => expect(trigger.textContent).toContain('Só Tamburetei'));
});
