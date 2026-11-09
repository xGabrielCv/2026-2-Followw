import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import type { PostKind } from '#/queries/community';
import type { Campus } from '#/queries/groups';

import { TabFilter } from '#/components/TabFilter';
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
import { Textarea } from '#/components/ui/textarea';
import { CAMPUS_LABELS, CAMPUSES } from '#/lib/campus';
import { useOnline } from '#/lib/online';
import { classroomsQueryOptions } from '#/queries/classrooms';
import { apiMessage, useCreatePost } from '#/queries/community';
import { meQueryOptions } from '#/queries/me';

export const POST_KIND_LABELS: Record<PostKind, string> = { duvida: 'Dúvida', post: 'Post' };
const NONE = 'none';

interface NewPostDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    campus?: Campus;
    hasCourse: boolean;
}

export function NewPostDialog({ open, onOpenChange, ...props }: NewPostDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Nova publicação</DialogTitle>
                    <DialogDescription>Dúvida ou recado para outros alunos.</DialogDescription>
                </DialogHeader>
                {open && <NewPostForm {...props} onDone={() => onOpenChange(false)} />}
            </DialogContent>
        </Dialog>
    );
}

export function NewPostForm({
    campus: defaultCampus,
    hasCourse,
    onDone
}: Omit<NewPostDialogProps, 'open' | 'onOpenChange'> & { onDone: () => void }) {
    const navigate = useNavigate();
    const [kind, setKind] = useState<PostKind>('duvida');
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [campus, setCampus] = useState<Campus | typeof NONE>(defaultCampus ?? NONE);
    const [subject, setSubject] = useState('');
    const [tagCourse, setTagCourse] = useState(false);
    const create = useCreatePost();
    const { data: user } = useQuery(meQueryOptions);
    const online = useOnline();
    const code = subject.trim().toUpperCase();
    // as matérias que o aluno cursa vêm das turmas salvas no navegador
    const { data: current } = useQuery(classroomsQueryOptions);
    const mine = [...new Map((current ?? []).map((c) => [c.subject.code, c.subject])).values()];
    const validCode = !code || /^[A-Z0-9]{3,16}$/.test(code);
    const valid = title.trim().length >= 5 && body.trim().length > 0 && validCode;

    return (
        <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
                event.preventDefault();
                if (!valid || create.isPending) return;
                create.mutate(
                    {
                        body: {
                            kind,
                            title: title.trim(),
                            body: body.trim(),
                            campus: campus === NONE ? null : campus,
                            subject: code || null,
                            course_id: tagCourse ? (user?.course?.id ?? null) : null
                        }
                    },
                    {
                        onSuccess: (post) => {
                            onDone();
                            if (post)
                                void navigate({ to: '/comunidade/$id', params: { id: post.id } });
                        }
                    }
                );
            }}
        >
            <p className="flex gap-2 rounded-xl bg-primary/10 p-3 text-xs">
                <ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden="true" />
                <span>
                    <strong className="font-semibold">Ninguém vê quem publicou.</strong> Nem nome,
                    nem matrícula. Só não escreva nada que identifique você ou outra pessoa.
                </span>
            </p>
            <TabFilter
                label="Tipo"
                value={kind}
                options={['duvida', 'post'] as const}
                labels={POST_KIND_LABELS}
                onChange={setKind}
            />
            <div className="flex flex-col gap-2">
                <Label htmlFor="post-title">Título</Label>
                <Input
                    id="post-title"
                    value={title}
                    maxLength={120}
                    placeholder={
                        kind === 'duvida'
                            ? 'Ex.: Como funciona o trancamento?'
                            : 'Ex.: Grupo de estudos de Cálculo'
                    }
                    onChange={(event) => setTitle(event.target.value)}
                />
            </div>
            <div className="flex flex-col gap-2">
                <Label htmlFor="post-body">Texto</Label>
                <Textarea
                    id="post-body"
                    value={body}
                    maxLength={4000}
                    className="min-h-28"
                    onChange={(event) => setBody(event.target.value)}
                />
                <span className="self-end text-xs text-muted-foreground tabular-nums">
                    {body.length}/4000
                </span>
            </div>
            <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">Campus</span>
                <TabFilter
                    label="Campus da publicação"
                    value={campus}
                    options={[NONE, ...CAMPUSES]}
                    labels={{ none: 'Todos', ...CAMPUS_LABELS }}
                    onChange={setCampus}
                    className="flex-wrap"
                />
            </div>
            <div className="flex flex-col gap-2">
                <Label htmlFor="post-subject">Matéria (código, opcional)</Label>
                <Input
                    id="post-subject"
                    value={subject}
                    maxLength={16}
                    placeholder="Ex.: FGA0030"
                    aria-invalid={!validCode}
                    onChange={(event) => setSubject(event.target.value)}
                />
                {mine.length > 0 && (
                    <div className="flex flex-wrap gap-1.5" aria-label="Suas matérias">
                        {mine.map((item) => (
                            <button
                                key={item.code}
                                type="button"
                                aria-pressed={code === item.code}
                                onClick={() => setSubject(code === item.code ? '' : item.code)}
                                className={
                                    code === item.code
                                        ? 'rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground'
                                        : 'rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground'
                                }
                                title={item.name}
                            >
                                {item.code}
                            </button>
                        ))}
                    </div>
                )}
            </div>
            {hasCourse && (
                <label className="flex items-start gap-2 text-sm">
                    <input
                        type="checkbox"
                        className="mt-0.5 size-4 accent-primary"
                        checked={tagCourse}
                        onChange={(event) => setTagCourse(event.target.checked)}
                    />
                    <span>
                        Marcar meu curso, para quem filtra pelo curso
                        <span className="block text-xs text-muted-foreground">
                            Em curso pequeno, isso pode ajudar a descobrir quem é você.
                        </span>
                    </span>
                </label>
            )}
            {create.isError && (
                <p role="alert" className="text-xs text-destructive">
                    {apiMessage(create.error, 'Não foi possível publicar. Confira os campos.')}
                </p>
            )}
            <DialogFooter>
                <Button type="button" variant="ghost" onClick={onDone}>
                    Cancelar
                </Button>
                <Button type="submit" disabled={!valid || create.isPending || !online}>
                    {create.isPending ? 'Publicando...' : 'Publicar'}
                </Button>
            </DialogFooter>
        </form>
    );
}
