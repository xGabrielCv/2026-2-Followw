import { useQuery } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { ClassroomKey, GroupLink, SavedGroup } from '#/queries/groups';

import { PlatformIcon } from '#/components/community/PlatformIcon';
import { ReportButton } from '#/components/community/ReportButton';
import { LoadingText } from '#/components/LoadingText';
import { Button } from '#/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '#/components/ui/dialog';
import { Input } from '#/components/ui/input';
import { Label } from '#/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '#/components/ui/select';
import {
    cleanGroups,
    MAX_GROUPS,
    PLATFORM_EXAMPLES,
    PLATFORM_LABELS,
    PLATFORMS,
    validGroupUrl
} from '#/lib/groups';
import { useOnline } from '#/lib/online';
import { classroomGroupsQueryOptions, useSaveGroups } from '#/queries/groups';

interface GroupsDialogProps extends ClassroomKey {
    // nome da matéria, para o título
    name: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const EMPTY_GROUP: GroupLink = { platform: 'whatsapp', url: '', password: null };
let nextDraft = 0;
const draft = (group: GroupLink) => ({ ...group, key: String(nextDraft++) });

const PRIVACY =
    'Qualquer aluno logado vê e edita estes grupos. Só a turma e os links são salvos, nunca quem cadastrou.';

/** Os grupos de conversa da turma (até 3): ver, cadastrar e editar, aberto a todos os alunos. */
export function GroupsDialog({ open, onOpenChange, name, ...key }: GroupsDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Grupos da turma</DialogTitle>
                    <DialogDescription>
                        {key.code} · Turma {key.number} · {key.semester}
                        <span className="block font-medium text-foreground">{name}</span>
                    </DialogDescription>
                </DialogHeader>
                {/* remonta a cada abertura para começar da lista salva */}
                {open && <GroupsContent classroom={key} />}
            </DialogContent>
        </Dialog>
    );
}

/** O conteúdo do diálogo: a lista salva ou o formulário de edição. */
export function GroupsContent({ classroom }: { classroom: ClassroomKey }) {
    const groups = useQuery(classroomGroupsQueryOptions(classroom));
    const [editing, setEditing] = useState<GroupLink[] | null>(null);

    if (groups.isPending) return <LoadingText>Carregando grupos...</LoadingText>;
    if (groups.isError)
        return (
            <p role="alert" className="text-sm text-destructive">
                Não foi possível carregar os grupos. Verifique a conexão e tente novamente.
            </p>
        );

    const saved = groups.data.groups;
    if (editing)
        return (
            <GroupsForm classroom={classroom} initial={editing} onDone={() => setEditing(null)} />
        );

    return (
        <div className="flex flex-col gap-4">
            {saved.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-xl bg-muted/40 p-4 text-center">
                    <p className="text-sm text-muted-foreground">
                        Ninguém cadastrou um grupo desta turma ainda.
                    </p>
                    <Button onClick={() => setEditing([EMPTY_GROUP])}>
                        <Plus aria-hidden="true" />
                        Cadastrar grupo
                    </Button>
                </div>
            ) : (
                <ul className="flex flex-col gap-2" aria-label="Grupos cadastrados">
                    {saved.map((group) => (
                        <GroupRow key={`${group.platform}-${group.url}`} group={group} />
                    ))}
                </ul>
            )}
            <p className="text-xs text-muted-foreground">{PRIVACY}</p>
            {saved.length > 0 && (
                <DialogFooter>
                    <Button variant="outline" onClick={() => setEditing(cleanGroups(saved))}>
                        Editar grupos
                    </Button>
                </DialogFooter>
            )}
        </div>
    );
}

function GroupRow({ group }: { group: SavedGroup }) {
    const [copied, setCopied] = useState(false);
    const label = PLATFORM_LABELS[group.platform];
    return (
        <li className="flex items-center gap-3 rounded-xl bg-muted/40 p-2.5">
            <PlatformIcon platform={group.platform} />
            <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">{label}</span>
                {group.password ? (
                    <button
                        type="button"
                        className="flex items-center gap-1 text-left text-xs text-muted-foreground hover:text-primary"
                        onClick={() => {
                            void navigator.clipboard?.writeText(group.password ?? '');
                            setCopied(true);
                        }}
                    >
                        Senha: <span className="font-mono text-foreground">{group.password}</span>
                        {copied ? (
                            <Check className="size-3" aria-label="Copiada" />
                        ) : (
                            <Copy className="size-3" aria-hidden="true" />
                        )}
                    </button>
                ) : (
                    <span className="truncate text-xs text-muted-foreground">
                        {new URL(group.url).hostname}
                    </span>
                )}
            </div>
            <a
                href={group.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-semibold text-primary hover:bg-primary/10"
                aria-label={`Entrar no grupo do ${label}`}
            >
                Entrar
                <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
            <ReportButton target="group" id={group.id} what="este link de grupo" />
        </li>
    );
}

function GroupsForm({
    classroom,
    initial,
    onDone
}: {
    classroom: ClassroomKey;
    initial: GroupLink[];
    onDone: () => void;
}) {
    // chave local de cada grupo no formulário, estável ao remover um do meio
    const [groups, setGroups] = useState(() => initial.map(draft));
    const save = useSaveGroups(classroom);
    const online = useOnline();
    const invalid = groups.some((group) => !validGroupUrl(group.platform, group.url));
    const update = (key: string, change: Partial<GroupLink>) =>
        setGroups((current) =>
            current.map((group) => (group.key === key ? { ...group, ...change } : group))
        );

    return (
        <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
                event.preventDefault();
                if (invalid || save.isPending) return;
                save.mutate(cleanGroups(groups), { onSuccess: onDone });
            }}
        >
            {groups.map((group, index) => (
                <GroupFields
                    key={group.key}
                    index={index}
                    group={group}
                    onChange={(change) => update(group.key, change)}
                    onRemove={() =>
                        setGroups((current) => current.filter(({ key }) => key !== group.key))
                    }
                />
            ))}
            {groups.length < MAX_GROUPS && (
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => setGroups((current) => [...current, draft(EMPTY_GROUP)])}
                >
                    <Plus aria-hidden="true" />
                    Adicionar grupo
                </Button>
            )}
            <p className="text-xs text-muted-foreground">{PRIVACY}</p>
            {save.isError && (
                <p role="alert" className="text-xs text-destructive">
                    Não foi possível salvar. Verifique os links e a conexão.
                </p>
            )}
            <DialogFooter>
                <Button type="button" variant="ghost" onClick={onDone}>
                    Cancelar
                </Button>
                <Button type="submit" disabled={invalid || save.isPending || !online}>
                    {save.isPending ? 'Salvando...' : 'Salvar grupos'}
                </Button>
            </DialogFooter>
        </form>
    );
}

const PLATFORM_ITEMS = PLATFORMS.map((value) => ({ value, label: PLATFORM_LABELS[value] }));

function GroupFields({
    index,
    group,
    onChange,
    onRemove
}: {
    index: number;
    group: GroupLink;
    onChange: (change: Partial<GroupLink>) => void;
    onRemove: () => void;
}) {
    const id = `group-${index}`;
    const touched = group.url.trim().length > 0;
    const wrong = touched && !validGroupUrl(group.platform, group.url);
    return (
        <fieldset className="flex flex-col gap-2 rounded-xl bg-muted/40 p-3">
            <div className="flex items-center justify-between gap-2">
                <legend className="text-sm font-semibold">Grupo {index + 1}</legend>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remover grupo ${index + 1}`}
                    onClick={onRemove}
                >
                    <Trash2 aria-hidden="true" />
                </Button>
            </div>
            <Label htmlFor={`${id}-platform`}>Plataforma</Label>
            <Select
                items={PLATFORM_ITEMS}
                value={group.platform}
                onValueChange={(value) => value && onChange({ platform: value })}
            >
                <SelectTrigger id={`${id}-platform`} className="w-full">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {PLATFORM_ITEMS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                            {item.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <Label htmlFor={`${id}-url`}>Link</Label>
            <Input
                id={`${id}-url`}
                type="url"
                inputMode="url"
                value={group.url}
                maxLength={300}
                placeholder={PLATFORM_EXAMPLES[group.platform]}
                aria-invalid={wrong}
                onChange={(event) => onChange({ url: event.target.value })}
            />
            {wrong && (
                <p className="text-xs text-destructive">
                    Use o link https do {PLATFORM_LABELS[group.platform]}.
                </p>
            )}
            {group.platform === 'aprender3' && (
                <>
                    <Label htmlFor={`${id}-password`}>Senha de inscrição (opcional)</Label>
                    <Input
                        id={`${id}-password`}
                        value={group.password ?? ''}
                        maxLength={64}
                        autoComplete="off"
                        onChange={(event) => onChange({ password: event.target.value })}
                    />
                </>
            )}
        </fieldset>
    );
}
