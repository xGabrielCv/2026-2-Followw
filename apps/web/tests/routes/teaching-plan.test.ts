import { environmentManager, type QueryKey } from '@tanstack/react-query';
import { describe, expect, test } from 'bun:test';

import type { TeachingPlan } from '#/queries/classrooms';

import { Route } from '#/routes/turmas_.$id_.plano-de-ensino';

import { fakeQueryClient, runLoader, useBrowserEnvironment } from '../helpers/route';

useBrowserEnvironment();

const PLAN: TeachingPlan = {
    methodology: 'Aulas práticas.',
    assessment_procedures: null,
    office_hours: null,
    schedule: [],
    assessments: [],
    basic_references: [],
    complementary_references: []
};

const CLASSROOM = { id: 'AAA', subject: { name: 'Matemática Discreta 2' } };

function setup(
    respond: (key: QueryKey) => unknown,
    cached: (key: QueryKey) => unknown = () => undefined
) {
    const paths: unknown[] = [];
    const queryClient = fakeQueryClient((key) => {
        paths.push(key[1]);
        return respond(key);
    }, cached);
    const load = () => runLoader(Route, { context: { queryClient }, params: { id: 'AAA' } });
    return { paths, load };
}

describe('rota independente do plano de ensino', () => {
    test('pré-carrega o plano quando a turma já está salva no navegador', async () => {
        const { paths, load } = setup(
            (key) => {
                if (key[1] === '/me') return { registration: '123' };
                if (key[1] === '/classrooms') return [CLASSROOM];
                return PLAN;
            },
            (key) => (key[1] === '/classrooms' ? [CLASSROOM] : undefined)
        );
        const loaded = await load();
        expect(loaded).toEqual({ subjectName: 'Matemática Discreta 2' });
        expect(paths).toEqual(['/me', '/classrooms', '/classrooms/{classroom_id}/teaching-plan']);
    });

    test('turma sabidamente sem plano no cache volta à turma sem consultar o SIGAA', async () => {
        const { paths, load } = setup(
            (key) => {
                if (key[1] === '/me') return { registration: '123' };
                if (key[1] === '/classrooms') return [CLASSROOM];
                return PLAN;
            },
            (key) => {
                if (key[1] === '/classrooms') return [CLASSROOM];
                if (key[1] === '/classrooms/{classroom_id}/teaching-plan') return null;
                return undefined;
            }
        );
        const error = await load().catch((reason: unknown) => reason);
        expect(error).toMatchObject({ options: { to: '/turmas/$id', params: { id: 'AAA' } } });
        expect(paths).toEqual(['/me', '/classrooms']);
    });

    test('sem login redireciona sem buscar turmas nem plano', async () => {
        const { paths, load } = setup(() => null);
        const error = await load().catch((reason: unknown) => reason);
        expect(error).toMatchObject({ options: { to: '/login' } });
        expect(paths).toEqual(['/me']);
    });

    test('turma fora da lista salva retorna não encontrado sem buscar plano', async () => {
        const { paths, load } = setup(
            (key) => (key[1] === '/me' ? { registration: '123' } : []),
            (key) => (key[1] === '/classrooms' ? [] : undefined)
        );
        const error = await load().catch((reason: unknown) => reason);
        expect(error).toMatchObject({ isNotFound: true });
        expect(paths).toEqual(['/me', '/classrooms']);
    });

    test('no SSR não consulta o SIGAA para carregar o plano', async () => {
        environmentManager.setIsServer(() => true);
        try {
            const { paths, load } = setup(
                (key) => (key[1] === '/me' ? { registration: '123' } : [CLASSROOM]),
                () => [CLASSROOM]
            );
            expect(await load()).toEqual({ subjectName: undefined });
            expect(paths).toEqual(['/me']);
        } finally {
            environmentManager.setIsServer(() => false);
        }
    });
});
