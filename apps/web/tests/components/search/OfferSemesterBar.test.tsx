import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { OfferSemesterBar } from '#/components/search/OfferSemesterBar';

const render = (nextAvailable: boolean, selected = '2026.2') =>
    renderToStaticMarkup(
        <OfferSemesterBar
            selected={selected}
            onChange={() => {}}
            choices={[
                { semester: '2026.2', kind: 'current', available: true },
                { semester: '2027.1', kind: 'next', available: nextAvailable }
            ]}
        />
    );

describe('OfferSemesterBar', () => {
    test('mostra o semestre atual e avisa quando a próxima oferta ainda não saiu', () => {
        const markup = render(false);
        expect(markup).toContain('2026.2');
        expect(markup).toContain('atual');
        expect(markup).toContain('em breve');
        expect(markup).toContain('A oferta de 2027.1 ainda não foi publicada no SIGAA');
        expect(markup).toContain('22/02/2027');
    });

    test('com a oferta publicada, o próximo semestre vira a prévia da grade', () => {
        const markup = render(true, '2027.1');
        expect(markup).toContain('próximo');
        expect(markup).not.toContain('em breve');
        expect(markup).toContain('Monte a prévia da sua grade de 2027.1');
    });
});
