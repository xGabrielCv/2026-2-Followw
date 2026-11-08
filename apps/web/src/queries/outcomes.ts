import type { components } from '#/queries/schema.gen';

import { api } from '#/queries/api';

export type OutcomeRates = components['schemas']['OutcomeRates'];
export type SubjectOutcomes = components['schemas']['SubjectOutcomes'];
export type ProfessorOutcome = components['schemas']['ProfessorOutcome'];
export type ProfessorOutcomes = components['schemas']['ProfessorOutcomes'];

// os índices só mudam quando um aluno sincroniza uma turma encerrada
const STALE_TIME = 30 * 60_000;

export const subjectOutcomesQueryOptions = (code: string) =>
    api.queryOptions(
        'get',
        '/public/subjects/{code}/outcomes',
        { params: { path: { code } } },
        { staleTime: STALE_TIME }
    );

export const professorOutcomesQueryOptions = (siape: number) =>
    api.queryOptions(
        'get',
        '/public/professors/{siape}/outcomes',
        { params: { path: { siape } } },
        { staleTime: STALE_TIME }
    );

/** Nome sem acento, caixa ou espaços extras, como a API compara docentes. */
export const nameKey = (name: string) =>
    name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
