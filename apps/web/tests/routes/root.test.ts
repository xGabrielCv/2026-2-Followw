import { QueryClient } from '@tanstack/react-query';
import * as StartServer from '@tanstack/react-start/server';
import { describe, expect, spyOn, test } from 'bun:test';

import { meQueryOptions } from '#/queries/me';
import { Route as RootRoute } from '#/routes/__root';

import manifest from '../../public/manifest.json';
import { callRoute } from '../helpers/route';

describe('rota raiz e manifest PWA', () => {
    test('beforeLoad sem cookie prepara o perfil anônimo apenas na requisição atual', async () => {
        const request = spyOn(StartServer, 'getRequest').mockReturnValue(
            new Request('http://localhost/')
        );
        const cookie = spyOn(StartServer, 'getCookie').mockReturnValue(undefined);
        const anonymous = new QueryClient();
        const authenticated = new QueryClient();
        try {
            await callRoute(RootRoute.options.beforeLoad, { context: { queryClient: anonymous } });
            expect(anonymous.getQueryData(meQueryOptions.queryKey)).toBeNull();
            cookie.mockReturnValue('sintetico');
            await callRoute(RootRoute.options.beforeLoad, {
                context: { queryClient: authenticated }
            });
            expect(authenticated.getQueryData(meQueryOptions.queryKey)).toBeUndefined();
        } finally {
            request.mockRestore();
            cookie.mockRestore();
            anonymous.clear();
            authenticated.clear();
        }
    });
    test('configura tags no head para suporte a PWA e instalação na tela inicial', async () => {
        const head = await callRoute(RootRoute.options.head);
        expect(head).toBeDefined();

        const links = head?.links ?? [];
        expect(links).toContainEqual({ rel: 'manifest', href: '/manifest.json' });
        expect(links).toContainEqual({ rel: 'icon', href: '/favicon.ico', sizes: '48x48' });
        expect(links).toContainEqual({ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' });
        expect(links).toContainEqual({
            rel: 'apple-touch-icon',
            href: '/apple-touch-icon.png?v=2'
        });

        const meta = head?.meta ?? [];
        expect(meta).toContainEqual({ name: 'theme-color', content: manifest.theme_color });
        expect(meta).toContainEqual({ name: 'apple-mobile-web-app-capable', content: 'yes' });
    });

    test('configura errorComponent na rota raiz', () => {
        expect(RootRoute.options.errorComponent).toBeDefined();
    });

    test('manifest possui campos obrigatórios para instalação como PWA', () => {
        expect(manifest.name).toBe('Followw');
        expect(manifest.short_name).toBe('Followw');
        expect(manifest.start_url).toBe('/');
        expect(manifest.display).toBe('standalone');
        expect(manifest.theme_color).toBe('#007c5d');
        expect(manifest.background_color).toBe('#171717');

        // ícone da aplicação instalada
        expect(manifest.icons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    src: '/app-icon.svg?v=2',
                    type: 'image/svg+xml'
                })
            ])
        );
    });
});
