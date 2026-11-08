import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { PostDetails, ReplyItem } from '#/queries/community';

import { POST_KIND_LABELS } from '#/components/community/NewPostDialog';
import { ReportButton } from '#/components/community/ReportButton';
import { ErrorCard, ErrorState } from '#/components/ErrorState';
import { BackHeader } from '#/components/HeaderBar';
import { LoginPromptCard } from '#/components/home/LoginPromptCard';
import { LoadingText } from '#/components/LoadingText';
import { Button } from '#/components/ui/button';
import { Textarea } from '#/components/ui/textarea';
import { CAMPUS_LABELS } from '#/lib/campus';
import { useOnline } from '#/lib/online';
import { relativeTime } from '#/lib/relative-time';
import { cn } from '#/lib/shadcn';
import {
    apiMessage,
    forumPostQueryOptions,
    useDeletePost,
    useDeleteReply,
    useReply
} from '#/queries/community';
import { meQueryOptions } from '#/queries/me';

export const Route = createFileRoute('/_app/comunidade_/$id')({
    head: () => ({ meta: [{ title: 'Conversa | Followw' }] }),
    staticData: {
        header: () => <BackHeader to="/comunidade" title="Conversa" />
    },
    errorComponent: ErrorState,
    component: PostPage
});

function PostPage() {
    const { id } = Route.useParams();
    const { data: user } = useSuspenseQuery(meQueryOptions);
    const post = useQuery({ ...forumPostQueryOptions(id), enabled: Boolean(user) });
    if (!user) return <LoginPromptCard />;
    if (post.isPending) return <LoadingText>Carregando conversa...</LoadingText>;
    if (post.isError)
        return (
            <ErrorCard
                message="Conversa não encontrada ou indisponível."
                onRetry={() => post.refetch()}
            />
        );
    return <Conversation post={post.data} />;
}

export function Conversation({ post }: { post: PostDetails }) {
    const navigate = useNavigate();
    const remove = useDeletePost();
    return (
        <div className="flex flex-col gap-4 pb-8">
            <article className="flex flex-col gap-2 rounded-2xl bg-card p-4 shadow-card ring-1 ring-foreground/8">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span
                        className={cn(
                            'rounded-full px-2 py-0.5 font-medium',
                            post.kind === 'duvida'
                                ? 'bg-warning/10 text-warning'
                                : 'bg-primary/10 text-primary'
                        )}
                    >
                        {POST_KIND_LABELS[post.kind]}
                    </span>
                    {post.subject && (
                        <span className="rounded-full bg-muted px-2 py-0.5 font-medium">
                            {post.subject.code} · {post.subject.name}
                        </span>
                    )}
                    {post.campus && (
                        <span className="rounded-full bg-muted px-2 py-0.5">
                            {CAMPUS_LABELS[post.campus]}
                        </span>
                    )}
                    {post.course && (
                        <span className="rounded-full bg-muted px-2 py-0.5">
                            {post.course.name}
                        </span>
                    )}
                    <span className="ml-auto text-muted-foreground">
                        {relativeTime(post.created_at)}
                    </span>
                </div>
                <h1 className="text-lg leading-snug font-semibold">{post.title}</h1>
                <p className="text-sm wrap-anywhere whitespace-pre-line">{post.body}</p>
                <div className="flex items-center justify-end gap-1">
                    {post.mine ? (
                        <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            disabled={remove.isPending}
                            onClick={() => {
                                if (!window.confirm('Apagar a publicação e as respostas?')) return;
                                remove.mutate(
                                    { params: { path: { post_id: post.id } } },
                                    { onSuccess: () => void navigate({ to: '/comunidade' }) }
                                );
                            }}
                        >
                            <Trash2 aria-hidden="true" />
                            Apagar
                        </Button>
                    ) : (
                        <ReportButton target="post" id={post.id} what="esta publicação" />
                    )}
                </div>
            </article>
            <section aria-label="Respostas" className="flex flex-col gap-2">
                <h2 className="px-1 text-sm font-semibold text-muted-foreground">
                    {post.replies.length === 0
                        ? 'Nenhuma resposta ainda'
                        : `${post.replies.length} ${post.replies.length === 1 ? 'resposta' : 'respostas'}`}
                </h2>
                <ul className="flex flex-col gap-2">
                    {post.replies.map((reply) => (
                        <ReplyRow key={reply.id} postId={post.id} reply={reply} />
                    ))}
                </ul>
                <ReplyForm postId={post.id} />
            </section>
        </div>
    );
}

function ReplyRow({ postId, reply }: { postId: string; reply: ReplyItem }) {
    const remove = useDeleteReply(postId);
    return (
        <li
            className={cn(
                'flex flex-col gap-1 rounded-2xl p-3 ring-1',
                reply.by_author ? 'bg-primary/5 ring-primary/20' : 'bg-card ring-foreground/8'
            )}
        >
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {reply.by_author && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                        Autor da conversa
                    </span>
                )}
                {reply.mine && !reply.by_author && (
                    <span className="rounded-full bg-muted px-2 py-0.5">Sua resposta</span>
                )}
                <span className="ml-auto">{relativeTime(reply.created_at)}</span>
                {reply.mine ? (
                    <button
                        type="button"
                        className="rounded-md p-1 hover:bg-muted hover:text-destructive"
                        aria-label="Apagar sua resposta"
                        disabled={remove.isPending}
                        onClick={() =>
                            window.confirm('Apagar sua resposta?') &&
                            remove.mutate({
                                params: { path: { post_id: postId, reply_id: reply.id } }
                            })
                        }
                    >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                    </button>
                ) : (
                    <ReportButton target="reply" id={reply.id} what="esta resposta" />
                )}
            </div>
            <p className="text-sm wrap-anywhere whitespace-pre-line">{reply.body}</p>
        </li>
    );
}

function ReplyForm({ postId }: { postId: string }) {
    const [body, setBody] = useState('');
    const reply = useReply(postId);
    const online = useOnline();
    return (
        <form
            className="flex flex-col gap-2 rounded-2xl bg-card p-3 shadow-card ring-1 ring-foreground/8"
            onSubmit={(event) => {
                event.preventDefault();
                if (!body.trim() || reply.isPending) return;
                reply.mutate(
                    { params: { path: { post_id: postId } }, body: { body: body.trim() } },
                    { onSuccess: () => setBody('') }
                );
            }}
        >
            <Textarea
                value={body}
                maxLength={2000}
                aria-label="Sua resposta"
                placeholder="Responder anonimamente..."
                onChange={(event) => setBody(event.target.value)}
            />
            {reply.isError && (
                <p role="alert" className="text-xs text-destructive">
                    {apiMessage(reply.error, 'Não foi possível responder. Tente novamente.')}
                </p>
            )}
            <Button
                type="submit"
                className="self-end"
                disabled={!body.trim() || reply.isPending || !online}
            >
                {reply.isPending ? 'Enviando...' : 'Responder'}
            </Button>
        </form>
    );
}
