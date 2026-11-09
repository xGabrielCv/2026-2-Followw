import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { components } from '#/queries/schema.gen';

import { api } from '#/queries/api';
import { apiClient } from '#/queries/client';
import { ApiError } from '#/queries/errors';

export type SubjectMaterials = components['schemas']['SubjectMaterials'];
export type MaterialItem = components['schemas']['MaterialItem'];
export type MaterialKind = MaterialItem['kind'];
export type SubjectWithMaterials = components['schemas']['SubjectWithMaterials'];
export type PostItem = components['schemas']['PostItem'];
export type PostDetails = components['schemas']['PostDetails'];
export type PostKind = PostItem['kind'];
export type ReplyItem = components['schemas']['ReplyItem'];
export type TutorialItem = components['schemas']['TutorialItem'];
export type TutorialDetails = components['schemas']['TutorialDetails'];
export type TutorialCategory = TutorialItem['category'];
export type ReportInput = components['schemas']['ReportInput'];
export type ReportTarget = ReportInput['target_type'];
export type ReportReason = ReportInput['reason'];

/** A mensagem que a API mandou (`detail`), para mostrar ao aluno o limite que bateu. */
export const apiMessage = (error: unknown, fallback: string) =>
    error instanceof ApiError && typeof error.detail === 'string' ? error.detail : fallback;

// ------------------------------------------------------------------ materiais

export const subjectMaterialsQueryOptions = (code: string) =>
    api.queryOptions('get', '/materials/{code}', { params: { path: { code } } });

export const materialSubjectsQueryOptions = (q?: string) =>
    api.queryOptions('get', '/materials', { params: { query: { q } } });

export interface MaterialForm {
    file: File;
    title: string;
    kind: MaterialKind;
    semester: string;
    classroom_number?: string | null;
}

export function useUploadMaterial(code: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (form: MaterialForm) => {
            const body = new FormData();
            body.set('file', form.file);
            body.set('title', form.title);
            body.set('kind', form.kind);
            body.set('semester', form.semester);
            if (form.classroom_number) body.set('classroom_number', form.classroom_number);
            const { data } = await apiClient.POST('/materials/{code}', {
                params: { path: { code } },
                // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- multipart vai como FormData
                body: body as never,
                bodySerializer: (value) => (value instanceof FormData ? value : body)
            });
            return data;
        },
        onSettled: () => queryClient.invalidateQueries({ queryKey: ['get', '/materials/{code}'] })
    });
}

export function useDeleteMaterial(code: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            await apiClient.DELETE('/materials/{code}/{material_id}', {
                params: { path: { code, material_id: id } }
            });
        },
        onSettled: () => queryClient.invalidateQueries({ queryKey: ['get', '/materials/{code}'] })
    });
}

/** O arquivo como blob, para abrir ou salvar sem expor a sessão num link. */
export async function downloadMaterial(
    code: string,
    id: string,
    signal?: AbortSignal
): Promise<Blob> {
    const { data } = await apiClient.GET('/materials/{code}/{material_id}', {
        params: { path: { code, material_id: id } },
        parseAs: 'blob',
        signal
    });
    if (!(data instanceof Blob)) throw new Error('Não foi possível baixar o arquivo');
    return data;
}

// ------------------------------------------------------------------ comunidade

export interface ForumSearch {
    kind?: PostKind;
    campus?: 'darcy' | 'gama' | 'ceilandia' | 'planaltina';
    course?: number;
    subject?: string;
    q?: string;
    order?: 'recent' | 'active' | 'unanswered';
}

export const forumPostQueryOptions = (id: string) =>
    api.queryOptions('get', '/forum/{post_id}', { params: { path: { post_id: id } } });

export function useCreatePost() {
    const queryClient = useQueryClient();
    return api.useMutation('post', '/forum', {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['get', '/forum'] })
    });
}

export function useReply(id: string) {
    const queryClient = useQueryClient();
    return api.useMutation('post', '/forum/{post_id}/replies', {
        onSuccess: (data) => {
            queryClient.setQueryData(forumPostQueryOptions(id).queryKey, data);
            void queryClient.invalidateQueries({ queryKey: ['get', '/forum'] });
        }
    });
}

export function useDeletePost() {
    const queryClient = useQueryClient();
    return api.useMutation('delete', '/forum/{post_id}', {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['get', '/forum'] })
    });
}

export function useResolvePost(id: string) {
    const queryClient = useQueryClient();
    return api.useMutation('patch', '/forum/{post_id}/resolved', {
        onSuccess: (data) => {
            queryClient.setQueryData(forumPostQueryOptions(id).queryKey, data);
            void queryClient.invalidateQueries({ queryKey: ['get', '/forum'] });
        }
    });
}

export function useDeleteReply(id: string) {
    const queryClient = useQueryClient();
    return api.useMutation('delete', '/forum/{post_id}/replies/{reply_id}', {
        onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: forumPostQueryOptions(id).queryKey })
    });
}

// ------------------------------------------------------------------ guias

export const tutorialsQueryOptions = (category?: TutorialCategory, q?: string) =>
    api.queryOptions('get', '/tutorials', { params: { query: { category, q } } });

export const tutorialQueryOptions = (id: string) =>
    api.queryOptions('get', '/tutorials/{tutorial_id}', {
        params: { path: { tutorial_id: id } }
    });

export const useSubmitTutorial = () => api.useMutation('post', '/tutorials');

// ------------------------------------------------------------------ denúncias

export const useReport = () => api.useMutation('post', '/reports');
