import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { BookOpen, ChevronRight, FolderOpen, Search } from 'lucide-react';
import { useQueryStates } from 'nuqs';
import { createStandardSchemaV1, parseAsString, parseAsStringLiteral } from 'nuqs/server';

import { ErrorCard, ErrorState } from '#/components/ErrorState';
import { BackHeader } from '#/components/HeaderBar';
import { LoginPromptCard } from '#/components/home/LoginPromptCard';
import { LoadingText } from '#/components/LoadingText';
import { TabFilter } from '#/components/TabFilter';
import { Input } from '#/components/ui/input';
import { useDebounced } from '#/lib/debounce';
import { allClassroomsQueryOptions } from '#/queries/classrooms';
import { materialSubjectsQueryOptions } from '#/queries/community';
import { meQueryOptions } from '#/queries/me';
import { searchQueryOptions } from '#/queries/search';

const VIEWS = ['com-material', 'todas'] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABELS: Record<View, string> = {
    'com-material': 'Com material',
    todas: 'Outras disciplinas'
};

const materiaisParsers = {
    q: parseAsString.withDefault(''),
    ver: parseAsStringLiteral(VIEWS).withDefault('com-material')
};

export const Route = createFileRoute('/_app/materiais')({
    validateSearch: createStandardSchemaV1(materiaisParsers, { partialOutput: true }),
    head: () => ({ meta: [{ title: 'Material das matérias | Followw' }] }),
    staticData: {
        header: () => <BackHeader to="/mais" title="Material das matérias" />
    },
    errorComponent: ErrorState,
    component: MateriaisPage
});

function MateriaisPage() {
    const { data: user } = useSuspenseQuery(meQueryOptions);
    return user ? <Materials /> : <LoginPromptCard />;
}

function Materials() {
    const [{ q, ver }, setSearch] = useQueryStates(materiaisParsers, {
        history: 'replace',
        scroll: false
    });
    const text = useDebounced(q.trim());
    const classrooms = useQuery(allClassroomsQueryOptions);
    const mine = [
        ...new Map(
            (classrooms.data ?? [])
                .filter((item) => item.current)
                .map((item) => [item.subject.code, item.subject])
        ).values()
    ];
    const all = ver === 'todas';

    return (
        <div className="flex flex-col gap-4 pb-8">
            <p className="text-sm text-muted-foreground">
                Provas, listas e resumos que os alunos compartilham por matéria, anonimamente. Dá
                para ver o de qualquer disciplina, mesmo as que você não cursa.
            </p>
            {mine.length > 0 && (
                <section className="flex flex-col gap-2">
                    <h2 className="px-1 text-sm font-semibold text-muted-foreground">
                        Suas matérias deste semestre
                    </h2>
                    <div className="flex flex-wrap gap-2">
                        {mine.map((subject) => (
                            <Link
                                key={subject.code}
                                to="/materiais/$code"
                                params={{ code: subject.code }}
                                className="rounded-full bg-card px-3 py-1.5 text-xs font-medium shadow-card ring-1 ring-foreground/8 hover:ring-primary/40"
                            >
                                <span className="font-semibold text-primary">{subject.code}</span>{' '}
                                {subject.name}
                            </Link>
                        ))}
                    </div>
                </section>
            )}
            <TabFilter
                label="Quais matérias mostrar"
                value={ver}
                options={VIEWS}
                labels={VIEW_LABELS}
                onChange={(value) =>
                    void setSearch({ ver: value === 'com-material' ? null : value })
                }
            />
            <div className="relative">
                <Search
                    className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                />
                <Input
                    type="search"
                    value={q}
                    maxLength={32}
                    onChange={(event) => void setSearch({ q: event.target.value || null })}
                    placeholder={
                        all ? 'Qualquer disciplina, por nome ou código...' : 'Matéria ou código...'
                    }
                    aria-label={all ? 'Buscar qualquer disciplina' : 'Buscar matéria com material'}
                    className="h-11 bg-card pl-10 text-sm"
                />
            </div>
            {all ? <AllSubjects text={text} /> : <WithMaterial text={text} />}
        </div>
    );
}

function WithMaterial({ text }: { text: string }) {
    const subjects = useQuery(materialSubjectsQueryOptions(text.length >= 3 ? text : undefined));
    if (subjects.isPending) return <LoadingText>Carregando matérias...</LoadingText>;
    if (subjects.isError)
        return (
            <ErrorCard
                message="Não foi possível carregar as matérias."
                onRetry={() => subjects.refetch()}
            />
        );
    if (subjects.data.length === 0)
        return (
            <p className="py-6 text-center text-sm text-muted-foreground">
                {text
                    ? 'Nenhuma matéria com material encontrada. Tente em "Outras disciplinas".'
                    : 'Ninguém compartilhou material ainda. Abra uma das suas matérias e envie o primeiro!'}
            </p>
        );
    return (
        <ul className="flex flex-col gap-2" aria-label="Matérias com material">
            {subjects.data.map((subject) => (
                <SubjectLink
                    key={subject.code}
                    code={subject.code}
                    name={subject.name}
                    detail={`${subject.files} ${subject.files === 1 ? 'arquivo' : 'arquivos'}`}
                />
            ))}
        </ul>
    );
}

function AllSubjects({ text }: { text: string }) {
    const enabled = text.length >= 3;
    const search = useQuery({ ...searchQueryOptions(text, ['subjects']), enabled });
    if (!enabled)
        return (
            <p className="py-6 text-center text-sm text-muted-foreground">
                Digite pelo menos 3 letras para buscar em todo o catálogo da UnB.
            </p>
        );
    if (search.isPending) return <LoadingText>Buscando disciplinas...</LoadingText>;
    if (search.isError)
        return (
            <ErrorCard
                message="Não foi possível buscar as disciplinas."
                onRetry={() => search.refetch()}
            />
        );
    const subjects = search.data.subjects ?? [];
    if (subjects.length === 0)
        return (
            <p className="py-6 text-center text-sm text-muted-foreground">
                Nenhuma disciplina encontrada.
            </p>
        );
    return (
        <ul className="flex flex-col gap-2" aria-label="Disciplinas do catálogo">
            {subjects.map((subject) => (
                <SubjectLink
                    key={subject.code}
                    code={subject.code}
                    name={subject.name}
                    detail="Ver material"
                    catalog
                />
            ))}
        </ul>
    );
}

function SubjectLink({
    code,
    name,
    detail,
    catalog = false
}: {
    code: string;
    name: string;
    detail: string;
    catalog?: boolean;
}) {
    const Icon = catalog ? BookOpen : FolderOpen;
    return (
        <li>
            <Link
                to="/materiais/$code"
                params={{ code }}
                className="group flex items-center gap-3 rounded-2xl bg-card p-3 shadow-card ring-1 ring-foreground/8 hover:ring-primary/40"
            >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-info/10 text-info">
                    <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-xs font-semibold text-primary">{code}</span>
                    <span className="truncate text-sm font-semibold">{name}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{detail}</span>
                <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                />
            </Link>
        </li>
    );
}
