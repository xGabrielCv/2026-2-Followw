import type { UserProfile } from '#/queries/me';
import type { UserSettings } from '#/queries/settings';

import { truncateProfileBio } from '#/lib/profile';

export const MAX_LOCAL_PHOTO_BYTES = 1024 * 1024;
const JPEG = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/;

export function localProfile(user: UserProfile, override?: UserSettings['profile']): UserProfile {
    if (!override) return user;
    const photo = override.photo;
    return {
        ...user,
        bio: typeof override.bio === 'string' ? truncateProfileBio(override.bio) : user.bio,
        photo:
            photo === null ||
            (typeof photo === 'string' &&
                photo.length <= MAX_LOCAL_PHOTO_BYTES * 1.4 &&
                JPEG.test(photo))
                ? photo
                : user.photo
    };
}

/** Só recebe o JPEG gerado pelo recorte; nunca envia o arquivo à API. */
export async function readProfilePhoto(file: File) {
    if (file.type !== 'image/jpeg' || file.size > MAX_LOCAL_PHOTO_BYTES)
        throw new Error('A foto ajustada deve ser JPEG de até 1 MB.');
    const signature = new Uint8Array(await file.slice(0, 3).arrayBuffer());
    if (signature[0] !== 255 || signature[1] !== 216 || signature[2] !== 255)
        throw new Error('Não foi possível validar a foto ajustada.');
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener(
            'load',
            () => {
                if (typeof reader.result === 'string' && JPEG.test(reader.result))
                    resolve(reader.result);
                else reject(new Error('Não foi possível preparar a foto.'));
            },
            { once: true }
        );
        reader.addEventListener('error', () => reject(new Error('Não foi possível ler a foto.')), {
            once: true
        });
        reader.readAsDataURL(file);
    });
}
