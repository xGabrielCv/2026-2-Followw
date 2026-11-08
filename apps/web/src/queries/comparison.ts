import type { components } from '#/queries/schema.gen';

import { api } from '#/queries/api';

export type Comparison = components['schemas']['Comparison'];
export type SubjectRate = components['schemas']['SubjectRate'];

// Só médias gerais (das turmas cujos alunos liberaram os índices): o histórico do aluno fica no
// aparelho e a comparação é feita aqui.
export const comparisonQueryOptions = (course?: number) =>
    api.queryOptions(
        'get',
        '/public/subjects/comparison',
        course ? { params: { query: { course } } } : {},
        { staleTime: 30 * 60_000 }
    );
