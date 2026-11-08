import type { QueryClient, QueryExecuteOptions, QueryKey } from '@tanstack/react-query';

import {
    allClassroomsQueryOptions,
    classroomFrequencyQueryOptions,
    classroomMembersQueryOptions,
    classroomPostsQueryOptions,
    classroomStatisticsQueryOptions,
    classroomsQueryOptions
} from '#/queries/classrooms';
import { internshipsQueryOptions } from '#/queries/internships';
import { latestNewsQueryOptions } from '#/queries/posts';

/**
 * Deixa pronto, em segundo plano, o que o aluno vai abrir: a API busca no SIGAA na hora (nada fica
 * no servidor), então o app pede antes e guarda no aparelho. A ordem é pela urgência: a agenda do
 * dia (turmas atuais), o histórico, a frequência de cada turma, as notícias, postagens e pessoas.
 *
 * Um passo por vez: a sessão do SIGAA do aluno atende uma requisição de cada vez, e o que o aluno
 * abre na tela não pode ficar atrás de uma fila longa. Dado ainda fresco no cache nem vai à rede.
 */
export interface SyncStep {
    name: string;
    ms: number;
    ok: boolean;
    cached: boolean;
}

// pausa entre os passos: o pedido que o aluno faz na tela passa na frente
const GAP_MS = 250;

const sleep = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
        });
    });

class Runner {
    readonly log: SyncStep[] = [];

    constructor(
        private readonly queryClient: QueryClient,
        private readonly signal: AbortSignal
    ) {}

    async step<TData, TError, TQueryKey extends QueryKey>(
        name: string,
        options: QueryExecuteOptions<TData, TError, TData, TData, TQueryKey>
    ): Promise<TData | undefined> {
        if (this.signal.aborted) return undefined;
        const state = this.queryClient.getQueryState(options.queryKey);
        const stale = options.staleTime;
        const fresh =
            state?.status === 'success' &&
            (stale === 'static' ||
                (typeof stale === 'number' && Date.now() - state.dataUpdatedAt < stale));
        const start = performance.now();
        try {
            const data = await this.queryClient.query(options);
            this.log.push({
                name,
                ms: Math.round(performance.now() - start),
                ok: true,
                cached: fresh
            });
            if (!fresh) await sleep(GAP_MS, this.signal);
            return data;
        } catch {
            this.log.push({
                name,
                ms: Math.round(performance.now() - start),
                ok: false,
                cached: false
            });
            return undefined;
        }
    }

    /** Os passos em sequência, um depois do outro. */
    async each<T>(items: readonly T[], run: (item: T) => Promise<unknown>) {
        await items.reduce<Promise<unknown>>(
            (previous, item) => previous.then(() => run(item)),
            Promise.resolve()
        );
    }
}

export async function runBackgroundSync(
    queryClient: QueryClient,
    signal: AbortSignal,
    { internships = true }: { internships?: boolean } = {}
): Promise<SyncStep[]> {
    const runner = new Runner(queryClient, signal);
    // 1. o básico: a agenda do dia e Minhas Turmas
    const current = (await runner.step('turmas atuais', classroomsQueryOptions)) ?? [];
    const all = (await runner.step('histórico', allClassroomsQueryOptions)) ?? [];
    // 2. o que mais se abre: a frequência de cada turma atual
    await runner.each(current, (classroom) =>
        runner.step(
            `frequência ${classroom.subject.code}`,
            classroomFrequencyQueryOptions(classroom.id)
        )
    );
    // 3. postagens (de onde saem as notícias da home) e pessoas das turmas atuais
    await runner.each(current, (classroom) =>
        runner.step(`postagens ${classroom.subject.code}`, classroomPostsQueryOptions(classroom.id))
    );
    // montadas das postagens já salvas: não vão ao SIGAA de novo
    await runner.step('notícias', latestNewsQueryOptions);
    await runner.each(current, (classroom) =>
        runner.step(`pessoas ${classroom.subject.code}`, classroomMembersQueryOptions(classroom.id))
    );
    // 4. os índices do último semestre encerrado (não mudam mais: só na primeira vez)
    const last = all
        .filter((classroom) => !classroom.current)
        .map((classroom) => classroom.semester)
        .toSorted()
        .at(-1);
    await runner.each(
        all.filter((item) => !item.current && item.semester === last),
        (classroom) =>
            runner.step(
                `índices ${classroom.subject.code}`,
                classroomStatisticsQueryOptions(classroom.id)
            )
    );
    // 5. por último, o mural de estágios
    if (internships) await runner.step('estágios', internshipsQueryOptions);
    return runner.log;
}
