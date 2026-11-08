import { useSuspenseQuery } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';

import type { LessonMarkStatus, LessonMarks } from '#/lib/lesson-marks';
import type { components } from '#/queries/schema.gen.ts';

import { marksStore, setMarks } from '#/lib/lesson-marks';
import { api } from '#/queries/api.ts';
import { meQueryOptions } from '#/queries/me.ts';

export type Classroom = components['schemas']['ParticipantClassroom'];
export type ClassroomPost = components['schemas']['ClassroomPost'];
export type PostType = components['schemas']['PostType'];

/** A menção vale nas turmas encerradas; nas atuais, quem ocupa o lugar dela é o local. */
export const finalGrade = (classroom: Classroom) =>
    classroom.current ? null : (classroom.grade ?? null);

// A API lê tudo isto do SIGAA na hora e não guarda: o navegador guarda e só pede de novo
// quando o dado envelhece (o app abre na hora com o que já tem).
const MINUTE = 60_000;
const LIST_STALE = 30 * MINUTE;
const DETAIL_STALE = 10 * MINUTE;

export const classroomsQueryOptions = api.queryOptions(
    'get',
    '/classrooms',
    {},
    { staleTime: LIST_STALE }
);

export const allClassroomsQueryOptions = api.queryOptions(
    'get',
    '/classrooms',
    { params: { query: { semester: 'all' } } },
    { staleTime: LIST_STALE }
);

export const classroomPostsQueryOptions = (id: string, type?: PostType) =>
    api.queryOptions(
        'get',
        '/classrooms/{classroom_id}/posts',
        { params: { path: { classroom_id: id }, ...(type ? { query: { type } } : {}) } },
        { staleTime: DETAIL_STALE }
    );

export const classroomPostDetailQueryOptions = (id: string, postId: string) =>
    api.queryOptions(
        'get',
        '/classrooms/{classroom_id}/posts/{post_id}',
        { params: { path: { classroom_id: id, post_id: postId } } },
        { staleTime: 'static' }
    );

export const classroomFrequencyQueryOptions = (id: string) =>
    api.queryOptions(
        'get',
        '/classrooms/{classroom_id}/frequency',
        { params: { path: { classroom_id: id } } },
        { staleTime: DETAIL_STALE }
    );

export type ClassroomFrequency = components['schemas']['ClassroomFrequencyView'];
export type Lesson = components['schemas']['Lesson'];
export type { LessonMarkStatus } from '#/lib/lesson-marks';

const NO_MARKS: LessonMarks = {};
const noSubscribe = () => () => {};
const noMarks = () => NO_MARKS;

/** As marcações de presença da turma, guardadas só neste navegador (nunca vão à API). */
export function useLessonMarks(id: string) {
    const { data: user } = useSuspenseQuery(meQueryOptions);
    const store = user ? marksStore(user.registration) : null;
    const all = useSyncExternalStore(
        store?.subscribe ?? noSubscribe,
        store?.getSnapshot ?? noMarks,
        noMarks
    );
    const mark = useCallback(
        (lessonIds: string[], status: LessonMarkStatus | null) => {
            if (store) store.set(setMarks(store.getSnapshot(), id, lessonIds, status));
        },
        [store, id]
    );
    return { marks: all[id], mark };
}

export const classroomMembersQueryOptions = (id: string) =>
    api.queryOptions(
        'get',
        '/classrooms/{classroom_id}/members',
        { params: { path: { classroom_id: id } } },
        { staleTime: 6 * 60 * MINUTE }
    );

// O índice de turma encerrada não muda mais.
export const classroomStatisticsQueryOptions = (id: string) =>
    api.queryOptions(
        'get',
        '/classrooms/{classroom_id}/statistics',
        { params: { path: { classroom_id: id } } },
        { staleTime: 'static' }
    );
