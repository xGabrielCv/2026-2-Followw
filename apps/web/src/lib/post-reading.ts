import type { ClassroomPost } from '#/queries/classrooms';

import { accountStore } from '#/lib/local-storage';

export type PostReadings = Record<string, string>;
export const NO_READINGS: PostReadings = {};
const LIMIT = 2000;

export const postReadingsStore = (registration: string) =>
    accountStore<PostReadings>(`post-reading:${registration}`, NO_READINGS);

const keyFor = (classroomId: string, postId: string) => JSON.stringify([classroomId, postId]);

// Notícias trazem o corpo só no detalhe; a lista fornece a versão disponível para a marcação.
const versionOf = (post: ClassroomPost) =>
    JSON.stringify([
        post.type,
        post.title,
        post.published_on,
        post.starts_on,
        post.ends_on,
        post.url,
        post.topic_id,
        post.type === 'news' ? null : post.content
    ]);

export const postWasRead = (readings: PostReadings, classroomId: string, post: ClassroomPost) =>
    readings[keyFor(classroomId, post.id)] === versionOf(post);

export function setPostReading(
    readings: PostReadings,
    classroomId: string,
    post: ClassroomPost,
    read: boolean
): PostReadings {
    const next = { ...readings };
    const key = keyFor(classroomId, post.id);
    delete next[key];
    if (read) next[key] = versionOf(post);
    return Object.fromEntries(Object.entries(next).slice(-LIMIT));
}
