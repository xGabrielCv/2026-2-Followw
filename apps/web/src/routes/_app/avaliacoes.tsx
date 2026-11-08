import { createFileRoute } from '@tanstack/react-router';
import { BookOpen, Search } from 'lucide-react';
import { useQueryStates } from 'nuqs';
import {
    createStandardSchemaV1,
    parseAsBoolean,
    parseAsString,
    parseAsStringLiteral
} from 'nuqs/server';

import type { ProfessorOrder } from '#/queries/reviews';

import { ErrorCard, ErrorState } from '#/components/ErrorState';
import { BackHeader } from '#/components/HeaderBar';
import { LoadingText } from '#/components/LoadingText';
import { ProfessorCard } from '#/components/search/ProfessorCard';
import { TabFilter } from '#/components/TabFilter';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { useDebounced } from '#/lib/debounce';
import { api } from '#/queries/api';

const ORDERS: ProfessorOrder[] = ['best', 'worst', 'reviews', 'name'];
const ORDER_LABELS: Record<ProfessorOrder, string> = {
    best: 'Melhores',
    worst: 'Piores',
    reviews: 'Mais avaliados',
    name: 'A–Z'
};
// a API aceita de 3 a 32 caracteres
const valid = (text: string) => (text.length >= 3 ? text : undefined);

const avaliacoesParsers = {
    q: parseAsString.withDefault(''),
    subject: parseAsString.withDefault(''),
    order: parseAsStringLiteral(ORDERS).withDefault('best'),
    rated: parseAsBoolean.withDefault(false)
};

export const Route = createFileRoute('/_app/avaliacoes')({
    validateSearch: createStandardSchemaV1(avaliacoesParsers, { partialOutput: true }),
    head: () => ({ meta: [{ title: 'Avaliações de professores | Followw' }] }),
    staticData: {
        header: () => <BackHeader to="/mais" title="Avaliações de professores" />
    },
    errorComponent: ErrorState,
    component: AvaliacoesPage
});

function AvaliacoesPage() {
    const [search, setSearch] = useQueryStates(avaliacoesParsers, {
        history: 'replace',
        scroll: false
    });
    const q = useDebounced(search.q.trim());
    const subject = useDebounced(search.subject.trim());

    return (
        <div className="flex flex-col gap-4 pb-8">
            <div className="flex flex-col gap-2">
                <SearchField
                    icon={<Search className="size-5" />}
                    value={search.q}
                    placeholder="Nome do professor..."
                    label="Buscar professor pelo nome"
                    onChange={(value) => void setSearch({ q: value || null })}
                />
                <SearchField
                    icon={<BookOpen className="size-5" />}
                    value={search.subject}
                    placeholder="Matéria que deu (nome ou código)..."
                    label="Filtrar professores pela matéria"
                    onChange={(value) => void setSearch({ subject: value || null })}
                />
            </div>
            <div className="-my-2 flex flex-col">
                <TabFilter
                    label="Ordenar"
                    value={search.order}
                    options={ORDERS}
                    labels={ORDER_LABELS}
                    onChange={(order) => void setSearch({ order: order === 'best' ? null : order })}
                />
                <TabFilter
                    label="Mostrar"
                    value={search.rated ? 'rated' : 'all'}
                    options={['all', 'rated'] as const}
                    labels={{ all: 'Todos os docentes', rated: 'Só avaliados' }}
                    onChange={(value) => void setSearch({ rated: value === 'rated' || null })}
                />
            </div>
            {(search.order === 'best' || search.order === 'worst') && !search.rated && (
                <p className="-mt-1 px-1 text-xs text-muted-foreground">
                    Quem ainda não tem avaliação conta como nota zero no ranking.
                </p>
            )}
            <Ranking
                q={valid(q)}
                subject={valid(subject)}
                order={search.order}
                rated={search.rated}
            />
        </div>
    );
}

function SearchField({
    icon,
    value,
    placeholder,
    label,
    onChange
}: {
    icon: React.ReactNode;
    value: string;
    placeholder: string;
    label: string;
    onChange: (value: string) => void;
}) {
    return (
        <div className="relative">
            <span
                className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
            >
                {icon}
            </span>
            <Input
                type="search"
                value={value}
                maxLength={32}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                aria-label={label}
                className="h-11 bg-card pl-10 text-sm"
            />
        </div>
    );
}

function Ranking({
    q,
    subject,
    order,
    rated
}: {
    q?: string;
    subject?: string;
    order: ProfessorOrder;
    rated: boolean;
}) {
    const pages = api.useInfiniteQuery(
        'get',
        '/public/professors',
        { params: { query: { q, subject, order, rated: rated || undefined } } },
        {
            initialPageParam: 1,
            pageParamName: 'page',
            getNextPageParam: (last) =>
                last.page * last.page_size < last.total ? last.page + 1 : undefined
        }
    );

    if (pages.isPending) return <LoadingText>Carregando docentes...</LoadingText>;
    if (pages.isError)
        return (
            <ErrorCard
                message="Não foi possível carregar os docentes."
                onRetry={() => pages.refetch()}
            />
        );

    const items = pages.data.pages.flatMap((page) => page.items);
    const total = pages.data.pages[0]?.total ?? 0;
    const ranked = order === 'best' || order === 'worst' || order === 'reviews';
    if (items.length === 0)
        return (
            <p className="py-8 text-center text-sm text-muted-foreground">
                Nenhum docente encontrado com esses filtros.
            </p>
        );

    return (
        <section aria-label="Docentes" className="flex flex-col gap-2">
            <p className="px-1 text-xs text-muted-foreground">
                {total} {total === 1 ? 'docente' : 'docentes'}
            </p>
            <ol className="flex flex-col gap-2">
                {items.map((professor, index) => (
                    <li key={professor.siape}>
                        <ProfessorCard
                            professor={professor}
                            rank={ranked ? index + 1 : undefined}
                        />
                    </li>
                ))}
            </ol>
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
