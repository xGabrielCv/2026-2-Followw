import { expect, test } from 'bun:test';

import type { UserProfile } from '#/queries/me';

import { localProfile, readProfilePhoto, MAX_LOCAL_PHOTO_BYTES } from '#/lib/local-profile';

const user: UserProfile = {
    name: 'Sintético',
    unit: null,
    course: null,
    entry_semester: null,
    integralization: null,
    workload: null,
    period_max_workload: null,
    ira: null,
    mp: null,
    level: 'Graduação',
    registration: 'conta-a',
    bio: 'Institucional',
    photo: 'https://origem/foto.jpg'
};

test('personalização local preserva identificadores e permite foto removida e bio vazia', () => {
    expect(localProfile(user, { photo: null, bio: '' })).toEqual({ ...user, photo: null, bio: '' });
    expect(localProfile(user)).toBe(user);
});

test.each(['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'https://rastreador/foto'])(
    'não aceita foto local não normalizada: %s',
    (photo) => {
        expect(localProfile(user, { photo }).photo).toBe(user.photo);
    }
);

test('recusa tipo, tamanho e assinatura antes de ler foto local', async () => {
    const files = [
        new File(['x'], 'a.svg', { type: 'image/svg+xml' }),
        new File([new Uint8Array(MAX_LOCAL_PHOTO_BYTES + 1)], 'a.jpg', { type: 'image/jpeg' }),
        new File(['html'], 'a.jpg', { type: 'image/jpeg' })
    ];
    const results = await Promise.all(
        files.map((file) =>
            readProfilePhoto(file).then(
                () => false,
                () => true
            )
        )
    );
    expect(results).toEqual([true, true, true]);
});
