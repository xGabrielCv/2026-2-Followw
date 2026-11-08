import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { components } from '#/queries/schema.gen';

import { api } from '#/queries/api';
import { apiClient } from '#/queries/client';

export type GroupLink = components['schemas']['GroupLink'];
export type SavedGroup = components['schemas']['SavedGroup'];
export type GroupPlatform = GroupLink['platform'];
export type ClassroomGroups = components['schemas']['ClassroomGroups'];
export type GroupedClassroom = components['schemas']['GroupedClassroom'];
export type Campus = NonNullable<GroupsSearch['campus']>;

export interface ClassroomKey {
    code: string;
    semester: string;
    number: string;
}

export interface GroupsSearch {
    semester: string;
    q?: string;
    campus?: 'darcy' | 'gama' | 'ceilandia' | 'planaltina';
    with_groups?: boolean;
    page?: number;
}

export const classroomGroupsQueryOptions = ({ code, semester, number }: ClassroomKey) =>
    api.queryOptions('get', '/groups/{code}/{semester}/{number}', {
        params: { path: { code, semester, number } }
    });

export const groupedClassroomsQueryOptions = (search: GroupsSearch) =>
    api.queryOptions('get', '/groups', { params: { query: search } });

/** Troca a lista de grupos da turma: qualquer aluno logado edita, sem autor. */
export function useSaveGroups(key: ClassroomKey) {
    const queryClient = useQueryClient();
    const { queryKey } = classroomGroupsQueryOptions(key);
    return useMutation({
        mutationFn: async (groups: GroupLink[]) => {
            const { data, error } = await apiClient.PUT('/groups/{code}/{semester}/{number}', {
                params: { path: key },
                body: { groups }
            });
            if (error || !data) throw new Error('Não foi possível salvar os grupos');
            return data;
        },
        onSuccess: (data) => {
            queryClient.setQueryData(queryKey, data);
            // a contagem da lista de turmas muda junto
            void queryClient.invalidateQueries({ queryKey: ['get', '/groups'] });
        }
    });
}
