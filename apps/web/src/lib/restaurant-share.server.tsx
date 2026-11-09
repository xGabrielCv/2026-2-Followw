import { loadRestaurantSearch, restaurantSelection } from '#/lib/restaurant-share';

export async function restaurantShareResponse(request: Request) {
    const search = loadRestaurantSearch(request);
    const selection = restaurantSelection(search);
    const [
        { default: renderSvg },
        { Resvg },
        { RestaurantShareImage },
        { loadSharedMenu },
        { restaurantImageFonts }
    ] = await Promise.all([
        import('satori'),
        import('@resvg/resvg-js'),
        import('#/components/ru/RestaurantShareImage'),
        import('#/queries/restaurant-share'),
        import('#/lib/restaurant-image-fonts.server')
    ]);
    try {
        const sections = await loadSharedMenu(request, selection);
        const svg = await renderSvg(
            <RestaurantShareImage selection={selection} sections={sections} />,
            { width: 1200, height: 630, fonts: restaurantImageFonts }
        );
        // Consome a renderização antes de responder para não cachear uma falha do renderer.
        return new Response(new Uint8Array(new Resvg(svg).render().asPng()), {
            headers: {
                'Content-Type': 'image/png',
                // Cardápio ainda não publicado não pode ficar preso no cache.
                'Cache-Control':
                    search.date && search.meal && search.campus && sections.length
                        ? 'public, max-age=5400, s-maxage=5400'
                        : 'no-store'
            }
        });
    } catch (error) {
        console.error(
            'Falha ao gerar a prévia pública do cardápio do RU:',
            error instanceof Error ? error.name : 'UnknownError'
        );
        return new Response('Não foi possível gerar a prévia do cardápio.', {
            status: 503,
            headers: { 'Cache-Control': 'no-store' }
        });
    }
}
