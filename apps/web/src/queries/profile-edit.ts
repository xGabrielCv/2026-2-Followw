import { useMutation, useQueryClient } from '@tanstack/react-query';

import { readProfilePhoto } from '#/lib/local-profile';
import { localVault } from '#/lib/local-vault';
import { truncateProfileBio } from '#/lib/profile';
import { meQueryOptions } from '#/queries/me';
import { settingsStore } from '#/queries/settings';

export function useEditProfile() {
    const client = useQueryClient();
    return useMutation({
        retry: false,
        networkMode: 'always',
        gcTime: 0,
        mutationFn: async ({
            bio,
            action,
            photo,
            displayName
        }: {
            bio?: string;
            action: 'keep' | 'replace' | 'remove';
            photo: File | null;
            displayName: string;
        }) => {
            const registration = client.getQueryData(meQueryOptions.queryKey)?.registration;
            if (!registration) throw new Error('Entre na conta para editar o perfil.');
            if ((action === 'replace') !== (photo !== null))
                throw new Error('Confira a foto selecionada.');
            const savedPhoto = photo ? await readProfilePhoto(photo) : undefined;
            if (client.getQueryData(meQueryOptions.queryKey)?.registration !== registration)
                throw new Error('A conta mudou. Abra o perfil novamente.');
            const store = settingsStore(registration);
            const previous = store.getSnapshot();
            store.set({
                ...previous,
                displayName: displayName.trim().slice(0, 24) || null,
                profile: {
                    ...previous.profile,
                    ...(bio !== undefined ? { bio: truncateProfileBio(bio) } : {}),
                    ...(action === 'remove' ? { photo: null } : {}),
                    ...(savedPhoto ? { photo: savedPhoto } : {})
                }
            });
            await localVault(window.localStorage).flush();
        }
    });
}
