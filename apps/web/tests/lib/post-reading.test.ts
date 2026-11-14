import { expect, test } from 'bun:test';

import type { ClassroomPost } from '#/queries/classrooms';

import { postReadingsStore, postWasRead, setPostReading } from '#/lib/post-reading';

const post: ClassroomPost = {
    id: 'news:1',
    type: 'news',
    title: 'Aviso da turma',
    published_on: '2026-11-14',
    attachments: []
};

test('leitura é separada por turma, versão e conta sem enviar dados ao servidor', () => {
    const a = postReadingsStore('leitura-a');
    const b = postReadingsStore('leitura-b');
    a.clear();
    b.clear();
    a.set(setPostReading(a.getSnapshot(), 'turma-a', post, true));
    expect(postWasRead(a.getSnapshot(), 'turma-a', post)).toBe(true);
    expect(postWasRead(a.getSnapshot(), 'turma-b', post)).toBe(false);
    expect(postWasRead(b.getSnapshot(), 'turma-a', post)).toBe(false);
    expect(postWasRead(a.getSnapshot(), 'turma-a', { ...post, title: 'Aviso revisado' })).toBe(
        false
    );
    a.set(setPostReading(a.getSnapshot(), 'turma-a', post, false));
    expect(a.getSnapshot()).toEqual({});
});

test('limita marcações antigas sem perder a última leitura', () => {
    let readings = {};
    for (let index = 0; index < 2010; index++)
        readings = setPostReading(readings, 'turma', { ...post, id: `news:${index}` }, true);
    expect(Object.keys(readings)).toHaveLength(2000);
    expect(postWasRead(readings, 'turma', { ...post, id: 'news:2009' })).toBe(true);
    expect(postWasRead(readings, 'turma', { ...post, id: 'news:0' })).toBe(false);
});
