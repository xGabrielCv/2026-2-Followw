import type { Classroom } from '#/queries/classrooms';
import type { CatalogSubject } from '#/queries/subjects';

import { api } from '#/queries/api';

export type Recommendation = NonNullable<CatalogSubject['recommendation']>;

const NO_CODES: string[] = [];

const SEMESTER = /^\d{4}\.\d$/;
const CODE = /^[A-Za-z0-9]{1,16}$/;

/** O histórico como a API pede (`CODIGO:AAAA.P:MENCAO:SITUACAO`), tirado das turmas salvas. */
export function classroomHistory(classrooms: readonly Classroom[] = []): string[] {
    return classrooms
        .filter((c) => CODE.test(c.subject.code) && SEMESTER.test(c.semester))
        .map((c) => [c.subject.code, c.semester, c.grade ?? '', c.status ?? ''].join(':'))
        .toSorted();
}

/**
 * Sem filtros, o /public/subjects devolve as recomendações do aluno logado. O histórico (turmas
 * e menções) e as matérias marcadas como concluídas ficam no navegador e vão junto: o servidor
 * não guarda nada disso.
 */
export const recommendationsQueryOptions = (
    completed: readonly string[] = NO_CODES,
    history: readonly string[] = NO_CODES
) => {
    const query = {
        ...(completed.length ? { completed: [...completed].toSorted() } : {}),
        ...(history.length ? { history: [...history] } : {})
    };
    return api.queryOptions(
        'get',
        '/public/subjects',
        Object.keys(query).length ? { params: { query } } : {},
        { staleTime: 0, gcTime: 60_000 }
    );
};

/** As recomendações mudam a cada sync: não vão para o cache salvo. */
export function isRecommendationsKey(key: readonly unknown[]) {
    if (key[0] !== 'get' || key[1] !== '/public/subjects') return false;
    const init = key[2];
    const params =
        typeof init === 'object' && init !== null && 'params' in init ? init.params : undefined;
    const query =
        typeof params === 'object' && params !== null && 'query' in params
            ? params.query
            : undefined;
    return (
        typeof query !== 'object' ||
        query === null ||
        Object.keys(query).every((name) => name === 'completed' || name === 'history')
    );
}

type Reason = Recommendation['reasons'][number];

const plural = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;

const reasonLabels: Record<Reason['code'], (value: number) => string> = {
    required: () => 'Obrigatória',
    target_period: () => 'Próximo período do fluxo',
    overdue: () => 'Atrasada no fluxo',
    same_unit: () => 'Da sua unidade',
    chain_length: (value) => `Inicia uma cadeia de ${plural(value, 'semestre', 'semestres')}`,
    chain_width: (value) => `É pré-requisito de ${plural(value, 'disciplina', 'disciplinas')}`,
    hours: (value) => `Carga horária de ${plural(value, 'hora', 'horas')}`
};

export const reasonLabel = (reason: Reason) => reasonLabels[reason.code](reason.value ?? 0);

/** Sem texto, as abas mostram só o que o aluno pode cursar; com busca, toda a oferta. */
export function showRecommendations(
    user: { level: string } | null | undefined,
    search: { q: string }
) {
    return user?.level === 'Graduação' && !search.q.trim();
}
