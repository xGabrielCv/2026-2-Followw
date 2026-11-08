import { QueryClient } from '@tanstack/react-query';
import { expect, test } from 'bun:test';

import { shouldPersistQuery } from '#/integrations/offline/storage';
import { recommendationsQueryOptions } from '#/queries/recommendations';

test('recomendações não são gravadas no cache offline; a busca continua persistida', () => {
    const client = new QueryClient();
    const plain = recommendationsQueryOptions().queryKey;
    const marked = recommendationsQueryOptions(['FGA0302', 'MAT0025']).queryKey;
    const search = ['get', '/public/subjects', { params: { query: { q: 'calculo' } } }];
    client.setQueryData(plain, []);
    client.setQueryData(marked, []);
    client.setQueryData(search, []);
    const persisted = (key: readonly unknown[]) =>
        shouldPersistQuery(client.getQueryCache().find({ queryKey: key, exact: true })!);
    expect(persisted(plain)).toBe(false);
    expect(persisted(marked)).toBe(false);
    expect(persisted(search)).toBe(true);
    client.clear();
});

test('as concluídas à mão vão na consulta, sempre na mesma ordem', () => {
    expect(recommendationsQueryOptions(['MAT0025', 'FGA0302']).queryKey).toEqual(
        recommendationsQueryOptions(['FGA0302', 'MAT0025']).queryKey
    );
    expect(recommendationsQueryOptions().queryKey).toEqual(['get', '/public/subjects', {}]);
});

test('recomendações aparecem só para graduação e sem pesquisa', async () => {
    const { showRecommendations } = await import('#/queries/recommendations');
    const student = { level: 'Graduação' };
    expect(showRecommendations(student, { q: '' })).toBe(true);
    expect(showRecommendations(student, { q: '  ' })).toBe(true);
    expect(showRecommendations(null, { q: '' })).toBe(false);
    expect(showRecommendations({ level: 'Mestrado' }, { q: '' })).toBe(false);
    expect(showRecommendations(student, { q: 'MAT0025' })).toBe(false);
});
