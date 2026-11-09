import { noop, useInfiniteQuery, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { MessageCircle, Plus, Search } from 'lucide-react';
import { useQueryStates } from 'nuqs';
import {
    createStandardSchemaV1,
    parseAsBoolean,
    parseAsString,
    parseAsStringLiteral
} from 'nuqs/server';
import { useState } from 'react';

import type { ForumListQuery, PostItem } from '#/queries/community';
import type { Campus } from '#/queries/groups';

import { NewPostDialog, POST_KIND_LABELS } from '#/components/community/NewPostDialog';
import { ErrorCard, ErrorState } from '#/components/ErrorState';
import { BackHeader } from '#/components/HeaderBar';
import { LoadingText } from '#/components/LoadingText';
import { TabFilter } from '#/components/TabFilter';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { useIsOwn } from '#/lib/author';
import { CAMPUS_LABELS, CAMPUSES, campusOfUnit } from '#/lib/campus';
import { useDebounced } from '#/lib/debounce';
import { relativeTime } from '#/lib/relative-time';
import { cn } from '#/lib/shadcn';
import { classroomsQueryOptions } from '#/queries/classrooms';
import { forumListQueryOptions } from '#/queries/community';
import { loadQuery } from '#/queries/load';
import { meQueryOptions } from '#/queries/me';

const ALL = 'all';
const KINDS = [ALL, 'duvida', 'post'] as const;
const ORDERS = ['recent', 'active', 'unanswered', 'unresolved', 'resolved'] as const;
const CAMPUS_OPTIONS = [ALL, ...CAMPUSES] as const;

const comunidadeParsers = {
    q: parseAsString.withDefault(''),
    kind: parseAsStringLiteral(KINDS).withDefault(ALL),
    order: parseAsStringLiteral(ORDERS).withDefault('recent'),
    region: parseAsStringLiteral(CAMPUS_OPTIONS),
    course: parseAsBoolean.withDefault(false),
    minhas: parseAsBoolean.withDefault(false)
};

export const Route = createFileRoute('/_app/comunidade')({
    validateSearch: createStandardSchemaV1(comunidadeParsers, { partialOutput: true }),
    loaderDeps: ({ search }) => ({
        kind: search.kind,
        order: search.order,
        region: search.region,
        course: search.course,
        minhas: search.minhas,
        q: search.q
    }),
    // A primeira página das conversas vai pronta no HTML; o LCP não espera o JavaScript.
    loader: async ({ context: { queryClient }, deps }) => {
        const user = await loadQuery(queryClient, meQueryOptions);
        if (deps.minhas) return;
        const text = (deps.q ?? '').trim();
        await queryClient
            .infiniteQuery(
                forumListQueryOptions(
                    forumQuery({
                        kind: deps.kind ?? ALL,
                        order: deps.order ?? 'recent',
                        campus: deps.region ?? campusOfUnit(user?.unit?.id) ?? ALL,
                        course: deps.course ? user?.course?.id : undefined,
                        q: text.length >= 3 ? text : undefined
                    })
                )
            )
            .catch(noop);
    },
    head: () => ({ meta: [{ title: 'Dúvidas e posts | Followw' }] }),
    staticData: {
        header: () => <BackHeader to="/mais" title="Dúvidas e posts" />
    },
    errorComponent: ErrorState,
    component: ComunidadePage
});

function forumQuery(input: {
    kind: (typeof KINDS)[number];
    order: (typeof ORDERS)[number];
    campus: Campus | typeof ALL;
    course?: number;
    q?: string;
}): ForumListQuery {
    return {
        ...input,
        kind: input.kind === ALL ? undefined : input.kind,
        campus: input.campus === ALL ? undefined : input.campus
    };
}

function ComunidadePage() {
    const { data: user } = useSuspenseQuery(meQueryOptions);
    return <Community campus={campusOfUnit(user?.unit?.id)} courseId={user?.course?.id} />;
}

function Community({ campus: myCampus, courseId }: { campus?: Campus; courseId?: number }) {
    const [search, setSearch] = useQueryStates(comunidadeParsers, {
        history: 'replace',
        scroll: false
    });
    const [writing, setWriting] = useState(false);
    const { data: user } = useSuspenseQuery(meQueryOptions);
    const campus = search.region ?? myCampus ?? ALL;
    const text = useDebounced(search.q.trim());
    // "das minhas matérias": os códigos vêm das turmas salvas no navegador, não do servidor
    const { data: current } = useQuery({ ...classroomsQueryOptions, enabled: Boolean(user) });
    const mySubjects = [...new Set((current ?? []).map((c) => c.subject.code))].toSorted();

    return (
        <div className="flex flex-col gap-4 pb-8">
            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Search
                        className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                    />
                    <Input
                        type="search"
                        value={search.q}
                        maxLength={32}
                        onChange={(event) => void setSearch({ q: event.target.value || null })}
                        placeholder="Buscar nas conversas..."
                        aria-label="Buscar nas conversas"
                        className="h-11 bg-card pl-10 text-sm"
                    />
                </div>
                {user && (
                    <Button className="h-11" onClick={() => setWriting(true)}>
                        <Plus aria-hidden="true" />
                        Publicar
                    </Button>
                )}
            </div>
            <div className="-my-2 flex flex-col">
                <TabFilter
                    label="Tipo"
                    value={search.kind}
                    options={KINDS}
                    labels={{ all: 'Tudo', duvida: 'Dúvidas', post: 'Posts' }}
                    onChange={(kind) => void setSearch({ kind: kind === ALL ? null : kind })}
                />
                <TabFilter
                    label="Ordem"
                    value={search.order}
                    options={ORDERS}
                    labels={{
                        recent: 'Mais recentes',
                        active: 'Movimentadas',
                        unanswered: 'Sem resposta',
                        unresolved: 'Dúvidas abertas',
                        resolved: 'Resolvidas'
                    }}
                    onChange={(order) =>
                        void setSearch({ order: order === 'recent' ? null : order })
                    }
                />
                <TabFilter
                    label="Campus"
                    value={campus}
                    options={CAMPUS_OPTIONS}
                    labels={{ all: 'Todos os campi', ...CAMPUS_LABELS }}
                    onChange={(region) => void setSearch({ region })}
                />
                {user && (
                    <TabFilter
                        label="Matérias"
                        value={search.minhas ? 'mine' : 'all'}
                        options={['all', 'mine'] as const}
                        labels={{ all: 'Todas as matérias', mine: 'Das minhas matérias' }}
                        onChange={(value) => void setSearch({ minhas: value === 'mine' || null })}
                    />
                )}
                {courseId != null && (
                    <TabFilter
                        label="Curso"
                        value={search.course ? 'mine' : 'all'}
                        options={['all', 'mine'] as const}
                        labels={{ all: 'Todos os cursos', mine: 'Só do meu curso' }}
                        onChange={(value) => void setSearch({ course: value === 'mine' || null })}
                    />
                )}
            </div>
            {user && search.minhas && mySubjects.length === 0 ? (
                <p className="rounded-2xl bg-card p-4 text-center text-sm text-muted-foreground">
                    {current
                        ? 'Você não tem turmas neste semestre para filtrar.'
                        : 'Carregando suas matérias...'}
                </p>
            ) : (
                <PostList
                    subjects={user && search.minhas ? mySubjects : undefined}
                    kind={search.kind === ALL ? undefined : search.kind}
                    order={search.order}
                    campus={campus === ALL ? undefined : campus}
                    course={search.course ? courseId : undefined}
                    q={text.length >= 3 ? text : undefined}
                    onWrite={user ? () => setWriting(true) : undefined}
                />
            )}
            {user && (
                <NewPostDialog
                    open={writing}
                    onOpenChange={setWriting}
                    campus={myCampus}
                    hasCourse={courseId != null}
                />
            )}
        </div>
    );
}

function PostList({
    onWrite,
    ...query
}: {
    kind?: 'duvida' | 'post';
    order: (typeof ORDERS)[number];
    campus?: Campus;
    course?: number;
    q?: string;
    subjects?: string[];
    onWrite?: () => void;
}) {
    const pages = useInfiniteQuery(forumListQueryOptions(query));
    if (pages.isPending) return <LoadingText>Carregando conversas...</LoadingText>;
    if (pages.isError)
        return (
            <ErrorCard
                message="Não foi possível carregar as conversas."
                onRetry={() => pages.refetch()}
            />
        );
    const items = pages.data.pages.flatMap((page) => page.items);
    if (items.length === 0)
        return (
            <div className="flex flex-col items-center gap-3 rounded-2xl bg-card p-6 text-center">
                <p className="text-sm text-muted-foreground">Nenhuma conversa por aqui ainda.</p>
                {onWrite && (
                    <Button variant="outline" onClick={onWrite}>
                        Começar uma conversa
                    </Button>
                )}
            </div>
        );
    return (
        <section aria-label="Conversas" className="flex flex-col gap-2">
            <ul className="flex flex-col gap-2">
                {items.map((post) => (
                    <li key={post.id}>
                        <PostCard post={post} />
                    </li>
                ))}
            </ul>
            {pages.hasNextPage && (
                <Button
                    variant="outline"
                    className="self-center"
                    disabled={pages.isFetchingNextPage}
                    onClick={() => void pages.fetchNextPage()}
                >
                    {pages.isFetchingNextPage ? 'Carregando...' : 'Mostrar mais'}
                </Button>
            )}
        </section>
    );
}

export function PostCard({ post }: { post: PostItem }) {
    const isOwn = useIsOwn();
    return (
        <Link
            to="/comunidade/$id"
            params={{ id: post.id }}
            className="flex flex-col gap-1.5 rounded-2xl bg-card p-3 shadow-card ring-1 ring-foreground/8 hover:ring-primary/40"
        >
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
                {post.resolved && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                        Resolvida
                    </span>
                )}
                {post.subject && (
                    <span className="rounded-full bg-muted px-2 py-0.5 font-medium">
                        {post.subject.code}
                    </span>
                )}
                {post.campus && (
                    <span className="rounded-full bg-muted px-2 py-0.5">
                        {CAMPUS_LABELS[post.campus]}
                    </span>
                )}
                {isOwn('post', post.id, post.mine) && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">Sua</span>
                )}
                {/* o tempo relativo muda entre o SSR e o navegador */}
                <span className="ml-auto text-muted-foreground" suppressHydrationWarning>
                    {relativeTime(post.created_at)}
                </span>
            </div>
            <span className="text-sm leading-snug font-semibold">{post.title}</span>
            <span className="line-clamp-2 text-xs text-muted-foreground">{post.excerpt}</span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <MessageCircle className="size-3.5" aria-hidden="true" />
                {post.reply_count === 0
                    ? 'Sem respostas'
                    : `${post.reply_count} ${post.reply_count === 1 ? 'resposta' : 'respostas'}`}
                {post.course && ` · ${post.course.name}`}
            </span>
        </Link>
    );
}
