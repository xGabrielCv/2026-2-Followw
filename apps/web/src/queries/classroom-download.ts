import { useMutation } from '@tanstack/react-query';

import { saveFile } from '#/lib/download';
import { apiClient } from '#/queries/client';

export function useDownloadMaterial(classroomId: string, postId: string) {
    return useMutation({
        mutationKey: ['download-classroom-material'],
        gcTime: 0,
        retry: false,
        mutationFn: async () => {
            const { data, response } = await apiClient.POST(
                '/classrooms/{classroom_id}/posts/{post_id}/download',
                {
                    params: { path: { classroom_id: classroomId, post_id: postId } },
                    parseAs: 'blob'
                }
            );
            const encoded = response.headers
                .get('content-disposition')
                ?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
            if (!data?.size || !encoded) throw new Error('Arquivo recebido incompleto.');
            saveFile(data, decodeURIComponent(encoded));
        }
    });
}
