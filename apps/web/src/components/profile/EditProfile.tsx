import { ImagePlus, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { UserProfile } from '#/queries/me';

import { PhotoCrop } from '#/components/profile/PhotoCrop';
import { Button } from '#/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from '#/components/ui/dialog';
import { Input } from '#/components/ui/input';
import { Label } from '#/components/ui/label';
import { PersonPhoto } from '#/components/ui/person-photo';
import { Textarea } from '#/components/ui/textarea';
import { toast } from '#/components/ui/toast';
import { truncateProfileBio } from '#/lib/profile';
import { useEditProfile } from '#/queries/profile-edit';

const MAX_ORIGINAL_PHOTO_MB = 4;
const PHOTO_EXTENSIONS = /\.(jpe?g|png)$/i;

type PhotoEdit = { action: 'keep' | 'remove' } | { action: 'replace'; file: File; preview: string };

export function EditProfile({
    user,
    displayName
}: {
    user: UserProfile;
    displayName?: string | null;
}) {
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger
                disabled={saving}
                render={
                    <Button
                        variant="ghost"
                        className="h-auto min-h-12 w-full justify-start gap-3 rounded-none px-3 py-2.5"
                    />
                }
            >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Pencil className="size-4" aria-hidden="true" />
                </span>
                <span className="flex-1 text-left">
                    {saving ? 'Salvando perfil...' : 'Editar perfil'}
                </span>
            </DialogTrigger>
            <DialogContent className="max-h-dvh overflow-y-auto sm:max-w-lg">
                {open && (
                    <ProfileForm
                        onSavingChange={setSaving}
                        user={user}
                        displayName={displayName}
                        close={() => setOpen(false)}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}

export function ProfileForm({
    user,
    displayName,
    close,
    onSavingChange
}: {
    user: UserProfile;
    displayName?: string | null;
    close: () => void;
    onSavingChange: (value: boolean) => void;
}) {
    const saving = useRef(false);
    const fileInput = useRef<HTMLInputElement>(null);
    const remote = useEditProfile();
    const [name, setName] = useState(displayName ?? '');
    const [savedBio] = useState(() => truncateProfileBio(user.bio ?? ''));
    const [bio, setBio] = useState(savedBio);
    const [photo, setPhoto] = useState<PhotoEdit>({ action: 'keep' });
    const [crop, setCrop] = useState<File | null>(null);
    const { action } = photo;
    const preview = action === 'replace' ? photo.preview : null;
    const [error, setError] = useState('');
    const pending = remote.isPending;
    useEffect(
        () => () => {
            if (preview) URL.revokeObjectURL(preview);
        },
        [preview]
    );
    async function save() {
        if (saving.current) return;
        saving.current = true;
        onSavingChange(true);
        setError('');
        try {
            await remote.mutateAsync({
                displayName: name,
                bio: bio === savedBio ? undefined : bio,
                action,
                photo: action === 'replace' ? photo.file : null
            });
            toast.add({ type: 'success', title: 'Perfil salvo neste navegador' });
            close();
        } catch {
            setError('Não foi possível salvar neste navegador. Tente novamente.');
            toast.add({ type: 'error', title: 'Não foi possível salvar o perfil' });
        } finally {
            saving.current = false;
            onSavingChange(false);
            remote.reset();
        }
    }
    const image = action === 'remove' ? null : (preview ?? user.photo);
    return (
        <>
            <DialogHeader>
                <DialogTitle>{crop ? 'Ajustar foto' : 'Editar perfil'}</DialogTitle>
                <DialogDescription>
                    Foto, bio e nome ficam cifrados neste navegador. Seu perfil no SIGAA permanece
                    como está.
                </DialogDescription>
            </DialogHeader>
            {crop ? (
                <PhotoCrop
                    file={crop}
                    onCancel={() => setCrop(null)}
                    onConfirm={(file) => {
                        setPhoto({ action: 'replace', file, preview: URL.createObjectURL(file) });
                        setCrop(null);
                    }}
                />
            ) : (
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (!pending) void save();
                    }}
                    className="flex flex-col gap-4"
                >
                    <fieldset disabled={pending} className="flex flex-col gap-6">
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="profile-photo">Foto de perfil</Label>
                            <div className="flex items-center gap-4">
                                <PersonPhoto src={image} size="lg" />
                                <div className="flex flex-wrap items-center gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => fileInput.current?.click()}
                                    >
                                        <ImagePlus data-icon="inline-start" aria-hidden="true" />
                                        Escolher foto
                                    </Button>
                                    <Input
                                        ref={fileInput}
                                        id="profile-photo"
                                        type="file"
                                        accept=".jpg,.jpeg,.png"
                                        className="hidden"
                                        onChange={(event) => {
                                            const file = event.target.files?.[0];
                                            event.target.value = '';
                                            if (!file) return;
                                            if (
                                                !PHOTO_EXTENSIONS.test(file.name) ||
                                                (file.type !== '' &&
                                                    !['image/jpeg', 'image/png'].includes(
                                                        file.type
                                                    )) ||
                                                file.size > MAX_ORIGINAL_PHOTO_MB * 1024 * 1024
                                            ) {
                                                setError(
                                                    `Escolha JPEG ou PNG de até ${MAX_ORIGINAL_PHOTO_MB} MB.`
                                                );
                                                return;
                                            }
                                            setError('');
                                            setCrop(file);
                                        }}
                                    />
                                    {image && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            onClick={() => setPhoto({ action: 'remove' })}
                                        >
                                            <Trash2 data-icon="inline-start" aria-hidden="true" />
                                            Remover foto
                                        </Button>
                                    )}
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                JPEG ou PNG, até {MAX_ORIGINAL_PHOTO_MB} MB.
                            </p>
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="display-name">Nome de exibição</Label>
                            <Input
                                id="display-name"
                                value={name}
                                maxLength={24}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={user.name}
                                autoComplete="nickname"
                            />
                            <p className="text-xs text-muted-foreground">
                                Este nome só aparecerá no seu Followw.
                            </p>
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="profile-bio">Bio</Label>
                            <Textarea
                                id="profile-bio"
                                value={bio}
                                rows={4}
                                placeholder="Escreva um pouco sobre você"
                                onChange={(e) => setBio(truncateProfileBio(e.target.value))}
                                className="field-sizing-fixed resize-none"
                            />
                        </div>
                    </fieldset>
                    {error && (
                        <p role="alert" className="text-sm text-destructive">
                            {error}
                        </p>
                    )}
                    <DialogFooter>
                        <Button type="button" variant="outline" disabled={pending} onClick={close}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={pending}>
                            {pending ? 'Salvando...' : 'Salvar alterações'}
                        </Button>
                    </DialogFooter>
                </form>
            )}
        </>
    );
}
