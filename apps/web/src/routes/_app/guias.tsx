import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { BookOpenText, ChevronRight, PenLine, Search } from 'lucide-react';
import { useQueryStates } from 'nuqs';
import { createStandardSchemaV1, parseAsString, parseAsStringLiteral } from 'nuqs/server';

import { ErrorCard, ErrorState } from '#/components/ErrorState';
import { BackHeader } from '#/components/HeaderBar';
import { LoadingText } from '#/components/LoadingText';
import { TabFilter } from '#/components/TabFilter';
import { buttonVariants } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { useDebounced } from '#/lib/debounce';
import { cn } from '#/lib/shadcn';
import { TUTORIAL_CATEGORIES, TUTORIAL_CATEGORY_LABELS } from '#/lib/tutorials';
import { tutorialsQueryOptions } from '#/queries/community';

const ALL = 'all';
const guiasParsers = {
    q: parseAsString.withDefault(''),
    category: parseAsStringLiteral([ALL, ...TUTORIAL_CATEGORIES]).withDefault(ALL)
};

export const Route = createFileRoute('/_app/guias')({
    validateSearch: createStandardSchemaV1(guiasParsers, { partialOutput: true }),
    head: () => ({ meta: [{ title: 'Guias da UnB | Followw' }] }),
    staticData: {
        header: () => <BackHeader to="/mais" title="Guias da UnB" />
    },
    errorComponent: ErrorState,
    component: GuiasPage
});

function GuiasPage() {
    const [search, setSearch] = useQueryStates(guiasParsers, { history: 'replace', scroll: false });
    const text = useDebounced(search.q.trim());
    const tutorials = useQuery(
        tutorialsQueryOptions(
            search.category === ALL ? undefined : search.category,
            text.length >= 3 ? text : undefined
        )
    );

    return (
        <div className="flex flex-col gap-4 pb-8">
            <div className="flex flex-col gap-2 rounded-2xl bg-card p-4 shadow-card ring-1 ring-foreground/8">
                <p className="text-sm text-muted-foreground">
                    Passo a passo de coisas da UnB escritos por outros alunos: estágio, matrícula,
                    documentos, auxílios. Todo guia passa pela moderação antes de aparecer.
                </p>
                <Link
                    to="/guias/novo"
                    className={cn(buttonVariants({ variant: 'outline' }), 'self-start')}
                >
                    <PenLine aria-hidden="true" />
                    Escrever um guia
                </Link>
            </div>
            <div className="relative">
                <Search
                    className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                />
                <Input
                    type="search"
                    value={search.q}
                    maxLength={32}
                    onChange={(event) => void setSearch({ q: event.target.value || null })}
                    placeholder="Buscar guias..."
                    aria-label="Buscar guias"
                    className="h-11 bg-card pl-10 text-sm"
                />
            </div>
            <TabFilter
                label="Categoria"
                value={search.category}
                options={[ALL, ...TUTORIAL_CATEGORIES]}
                labels={{ all: 'Todos', ...TUTORIAL_CATEGORY_LABELS }}
                onChange={(category) =>
                    void setSearch({ category: category === ALL ? null : category })
                }
                className="-my-2"
            />
            {tutorials.isPending ? (
                <LoadingText>Carregando guias...</LoadingText>
            ) : tutorials.isError ? (
                <ErrorCard
                    message="Não foi possível carregar os guias."
                    onRetry={() => tutorials.refetch()}
                />
            ) : tutorials.data.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                    Nenhum guia aqui ainda. Que tal escrever o primeiro?
                </p>
            ) : (
                <ul className="flex flex-col gap-2" aria-label="Guias">
                    {tutorials.data.map((tutorial) => (
                        <li key={tutorial.id}>
                            <Link
                                to="/guias/$id"
                                params={{ id: tutorial.id }}
                                className="group flex items-start gap-3 rounded-2xl bg-card p-3 shadow-card ring-1 ring-foreground/8 hover:ring-primary/40"
                            >
                                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-flow-1/15 text-flow-1">
                                    <BookOpenText className="size-4" aria-hidden="true" />
                                </span>
                                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                    <span className="text-xs font-medium text-muted-foreground">
                                        {TUTORIAL_CATEGORY_LABELS[tutorial.category]}
                                    </span>
                                    <span className="text-sm leading-snug font-semibold">
                                        {tutorial.title}
                                    </span>
                                    <span className="line-clamp-2 text-xs text-muted-foreground">
                                        {tutorial.summary}
                                    </span>
                                </span>
                                <ChevronRight
                                    className="mt-3 size-4 shrink-0 text-muted-foreground"
                                    aria-hidden="true"
                                />
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
