import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { BriefcaseBusiness, CalendarClock, ExternalLink, Search, Users } from 'lucide-react';
import { useQueryStates } from 'nuqs';
import {
    createStandardSchemaV1,
    parseAsBoolean,
    parseAsString,
    parseAsStringLiteral
} from 'nuqs/server';
import { useState } from 'react';

import type { InternshipItem } from '#/queries/internships';

import {
    ErrorCard,
    ErrorState,
    SIGAA_DOWN_MESSAGE,
    StaleDataNotice
} from '#/components/ErrorState';
import { BackHeader } from '#/components/HeaderBar';
import { LoginPromptCard } from '#/components/home/LoginPromptCard';
import { LoadingText } from '#/components/LoadingText';
import { TabFilter } from '#/components/TabFilter';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from '#/components/ui/dialog';
import { Input } from '#/components/ui/input';
import { useDebounced } from '#/lib/debounce';
import { filterInternships } from '#/lib/internships';
import { Markdown } from '#/lib/markdown';
import {
    formatStipend,
    internshipQueryOptions,
    internshipsQueryOptions
} from '#/queries/internships';
import { meQueryOptions } from '#/queries/me';

const SCOPES = ['mine', 'all'] as const;
const ORDERS = ['closing', 'stipend', 'recent'] as const;

const estagiosParsers = {
    q: parseAsString.withDefault(''),
    scope: parseAsStringLiteral(SCOPES).withDefault('mine'),
    order: parseAsStringLiteral(ORDERS).withDefault('closing'),
    bolsa: parseAsBoolean.withDefault(false)
};

export const Route = createFileRoute('/_app/estagios')({
    validateSearch: createStandardSchemaV1(estagiosParsers, { partialOutput: true }),
    head: () => ({ meta: [{ title: 'Estágios | Followw' }] }),
    staticData: {
        header: () => <BackHeader to="/mais" title="Estágios" />
    },
    errorComponent: ErrorState,
    component: EstagiosPage
});

function EstagiosPage() {
    const { data: user } = useSuspenseQuery(meQueryOptions);
    return user ? <Internships /> : <LoginPromptCard />;
}

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const formatDate = (value: string) => dateTime.format(new Date(value));

function Internships() {
    const [search, setSearch] = useQueryStates(estagiosParsers, {
        history: 'replace',
        scroll: false
    });
    const q = useDebounced(search.q.trim());
    const list = useQuery(internshipsQueryOptions);
    const [selected, setSelected] = useState<InternshipItem | null>(null);

    if (list.isPending) return <LoadingText>Lendo o mural de estágios do SIGAA...</LoadingText>;
    if (list.isLoadingError)
        return <ErrorCard message={SIGAA_DOWN_MESSAGE} onRetry={() => list.refetch()} />;

    const items = filterInternships(list.data, { ...search, q });

    return (
        <div className="flex flex-col gap-3 pb-8">
            {list.isError && <StaleDataNotice subject="o mural" />}
            <p className="text-sm text-muted-foreground">
                As vagas do mural de estágios do SIGAA, lidas com a sua sessão. Para se candidatar,
                siga as instruções de cada oferta.
            </p>
            <div className="relative">
                <Search
                    className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                />
                <Input
                    type="search"
                    value={search.q}
                    maxLength={40}
                    onChange={(event) => void setSearch({ q: event.target.value || null })}
                    placeholder="Buscar vaga..."
                    aria-label="Buscar vaga de estágio"
                    className="h-11 bg-card pl-10 text-sm"
                />
            </div>
            <div className="-my-1 flex flex-col">
                <TabFilter
                    label="Cursos"
                    value={search.scope}
                    options={SCOPES}
                    labels={{ mine: 'Do meu curso', all: 'Todos os cursos' }}
                    onChange={(scope) => void setSearch({ scope: scope === 'mine' ? null : scope })}
                />
                <TabFilter
                    label="Ordem"
                    value={search.order}
                    options={ORDERS}
                    labels={{
                        closing: 'Encerram antes',
                        stipend: 'Maior bolsa',
                        recent: 'Encerram depois'
                    }}
                    onChange={(order) =>
                        void setSearch({ order: order === 'closing' ? null : order })
                    }
                />
                <TabFilter
                    label="Bolsa"
                    value={search.bolsa ? 'com' : 'todas'}
                    options={['todas', 'com'] as const}
                    labels={{ todas: 'Com e sem bolsa', com: 'Só com bolsa' }}
                    onChange={(value) => void setSearch({ bolsa: value === 'com' || null })}
                />
            </div>
            <p className="px-1 text-xs text-muted-foreground" aria-live="polite">
                {items.length} {items.length === 1 ? 'vaga aberta' : 'vagas abertas'}
            </p>
            {items.length === 0 ? (
                <p className="rounded-2xl bg-card p-6 text-center text-sm text-muted-foreground">
                    Nenhuma vaga aberta com esses filtros.
                </p>
            ) : (
                <ul className="flex flex-col gap-2" aria-label="Vagas de estágio">
                    {items.map((item) => (
                        <li key={item.reference}>
                            <button
                                type="button"
                                onClick={() => setSelected(item)}
                                className="flex w-full flex-col gap-2 rounded-2xl bg-card p-3 text-left shadow-card ring-1 ring-foreground/8 hover:ring-primary/40"
                            >
                                <span className="flex items-start gap-3">
                                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-flow-4/15 text-flow-4">
                                        <BriefcaseBusiness className="size-4" aria-hidden="true" />
                                    </span>
                                    <span className="min-w-0 flex-1 text-sm font-semibold">
                                        {item.title}
                                    </span>
                                </span>
                                <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                    <span className="font-semibold text-primary">
                                        {formatStipend(item.stipend)}
                                    </span>
                                    <span className="inline-flex items-center gap-1">
                                        <Users className="size-3" aria-hidden="true" />
                                        {item.vacancies} {item.vacancies === 1 ? 'vaga' : 'vagas'}
                                    </span>
                                    <span className="inline-flex items-center gap-1">
                                        <CalendarClock className="size-3" aria-hidden="true" />
                                        até {formatDate(item.published_until)}
                                    </span>
                                    {!item.mine && <span>Outros cursos</span>}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            <InternshipDialog item={selected} onClose={() => setSelected(null)} />
        </div>
    );
}

function InternshipDialog({ item, onClose }: { item: InternshipItem | null; onClose: () => void }) {
    const detail = useQuery({
        ...internshipQueryOptions(item?.reference ?? ''),
        enabled: item !== null
    });
    const data = detail.data;
    return (
        <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{item?.title}</DialogTitle>
                    <DialogDescription>
                        {item ? `${formatStipend(item.stipend)} · ${item.vacancies} vaga(s)` : ''}
                    </DialogDescription>
                </DialogHeader>
                {detail.isPending ? (
                    <LoadingText>Abrindo a oferta no SIGAA...</LoadingText>
                ) : detail.isError || !data ? (
                    <p className="text-sm text-muted-foreground">
                        Não foi possível abrir a oferta (o mural pode ter mudado). Feche e tente de
                        novo.
                    </p>
                ) : (
                    <div className="flex flex-col gap-3 text-sm">
                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                            <dt className="text-muted-foreground">Concedente</dt>
                            <dd>{data.grantor.name}</dd>
                            <dt className="text-muted-foreground">Inscrições</dt>
                            <dd>
                                {formatDate(data.published_from)} a{' '}
                                {formatDate(data.published_until)}
                            </dd>
                            {data.transport_allowance && (
                                <>
                                    <dt className="text-muted-foreground">Transporte</dt>
                                    <dd>
                                        {formatStipend(data.transport_allowance.amount)} (
                                        {data.transport_allowance.period})
                                    </dd>
                                </>
                            )}
                            <dt className="text-muted-foreground">Inscrição</dt>
                            <dd>{data.sigaa_enrollment ? 'Pelo SIGAA' : 'Fora do SIGAA'}</dd>
                        </dl>
                        {data.courses.length > 0 && (
                            <section>
                                <h3 className="mb-1 font-semibold">Cursos</h3>
                                <ul className="flex flex-wrap gap-1.5">
                                    {data.courses.map((course) => (
                                        <li
                                            key={`${course.name}-${course.unit}`}
                                            className="rounded-full bg-muted px-2.5 py-1 text-xs"
                                        >
                                            {course.name}
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}
                        {data.description && (
                            <section>
                                <h3 className="mb-1 font-semibold">Descrição</h3>
                                <Markdown community>{data.description}</Markdown>
                            </section>
                        )}
                        {data.attachment && (
                            <a
                                href={data.attachment.url}
                                target="_blank"
                                rel="external noopener noreferrer"
                                className="inline-flex items-center gap-1 text-primary underline underline-offset-4"
                            >
                                {data.attachment.name}
                                <ExternalLink className="size-3" aria-hidden="true" />
                            </a>
                        )}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
