import { noop, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { SearchCategory } from '#/lib/search-categories';
import type { UserProfile } from '#/queries/me';

import { getCurrentSemester } from '#/calendar';
import { ErrorState } from '#/components/ErrorState';
import { HeaderBar, HeaderTitle } from '#/components/HeaderBar';
import { SchedulePreview } from '#/components/schedule/SchedulePreview';
import {
    CatalogResults,
    type CatalogCategory,
    catalogQueryOptions
} from '#/components/search/CatalogResults';
import { OfferSemesterBar } from '#/components/search/OfferSemesterBar';
import { PlanningGuide } from '#/components/search/PlanningGuide';
import { RecommendationsSection } from '#/components/search/RecommendationsSection';
import { SearchResults } from '#/components/search/SearchResults';
import { SubjectResults } from '#/components/search/SubjectResults';
import { TabFilter } from '#/components/TabFilter';
import { Input } from '#/components/ui/input';
import { offerChoices, semesterParam } from '#/lib/offer';
import { nowInBrasilia } from '#/lib/schedule';
import {
    SEARCH_CATEGORIES,
    searchCategoryLabels,
    searchEmptyMessages,
    searchTypes,
    showsSubjects
} from '#/lib/search-categories';
import { loadSearchParams, useSearchState, validateSearch } from '#/lib/search-params';
import { allClassroomsQueryOptions } from '#/queries/classrooms';
import { loadPersonal, loadQuery } from '#/queries/load';
import { meQueryOptions } from '#/queries/me';
import {
    classroomHistory,
    recommendationsQueryOptions,
    showRecommendations
} from '#/queries/recommendations';
import { searchQueryOptions } from '#/queries/search';
import { settingsStore } from '#/queries/settings';
import { useCompletedSubjects } from '#/queries/settings';
import {
    takenCodes,
    currentCurriculumPeriod,
    SEARCH_MAX_LENGTH,
    SEARCH_MIN_LENGTH,
    offerSemestersQueryOptions,
    searchText,
    subjectsQueryOptions
} from '#/queries/subjects';

type SearchView =
    | { kind: 'recommendations' }
    | { kind: 'catalog'; category: CatalogCategory }
    | { kind: 'search'; text: string }
    | { kind: 'unit'; unit: string };

/** Sem texto, as abas com matérias mostram as recomendações ou a unidade do aluno, e as demais o catálogo. */
function searchView(
    category: SearchCategory,
    q: string,
    text: string | null,
    user: UserProfile | null
): SearchView | null {
    const subjects = showsSubjects(category);
    if (subjects && showRecommendations(user, { q })) return { kind: 'recommendations' };
    if (text) return { kind: 'search', text };
    if (category === 'courses' || category === 'professors') return { kind: 'catalog', category };
    const unit = user?.unit?.code;
    return subjects && unit ? { kind: 'unit', unit } : null;
}

/** Semestre exibido (o escolhido com oferta ou o atual) e o parâmetro que vai à API. */
function offerSemester(available: string[], picked: string | null) {
    const { choices, resolve } = offerChoices(available, nowInBrasilia().date);
    const selected = resolve(picked);
    return { choices, selected, param: semesterParam(selected, available) };
}

export const Route = createFileRoute('/_app/buscar')({
    head: () => ({ meta: [{ title: 'Buscar | Followw' }] }),
    validateSearch,
    // O componente consulta após o debounce; o loader só pré-carrega ao entrar na página.
    shouldReload: ({ cause }) => cause !== 'stay',
    loader: async ({ context: { queryClient }, location }) => {
        const user = await loadQuery(queryClient, meQueryOptions);
        const { q, category, semester } = loadSearchParams(location.searchStr);
        const view = searchView(category, q, searchText(q), user);
        // a lista de semestres não segura a página: usa a salva, e o componente atualiza
        const offer: string[] | undefined = queryClient.getQueryData(
            offerSemestersQueryOptions.queryKey
        );
        const apiSemester = offerSemester(offer ?? [], semester).param;
        await Promise.all([
            showsSubjects(category) && user && loadPersonal(queryClient, allClassroomsQueryOptions),
            view?.kind === 'recommendations' &&
                user &&
                queryClient.getQueryData(allClassroomsQueryOptions.queryKey) &&
                loadPersonal(
                    queryClient,
                    recommendationsQueryOptions(
                        settingsStore(user.registration).getSnapshot().completedSubjects,
                        classroomHistory(
                            queryClient.getQueryData(allClassroomsQueryOptions.queryKey)
                        )
                    )
                ),
            view?.kind === 'search' &&
                loadQuery(
                    queryClient,
                    searchQueryOptions(view.text, searchTypes[category], apiSemester)
                ).catch(noop),
            view?.kind === 'catalog' &&
                (view.category === 'courses'
                    ? loadQuery(queryClient, catalogQueryOptions.courses)
                    : loadQuery(queryClient, catalogQueryOptions.professors)
                ).catch(noop),
            view?.kind === 'unit' &&
                loadQuery(
                    queryClient,
                    subjectsQueryOptions(
                        apiSemester
                            ? { unit: view.unit, semester: apiSemester }
                            : { unit: view.unit }
                    )
                ).catch(noop)
        ]);
    },
    staticData: {
        header: () => (
            <HeaderBar>
                <HeaderTitle>Buscar</HeaderTitle>
            </HeaderBar>
        )
    },
    errorComponent: ErrorState,
    component: BuscarPage
});

function BuscarPage() {
    const { data: user } = useSuspenseQuery(meQueryOptions);
    const [{ q, category, semester }, setSearch] = useSearchState();
    const subjects = showsSubjects(category);
    const { data: offer } = useQuery({ ...offerSemestersQueryOptions, enabled: subjects });
    const { choices, selected, param: apiSemester } = offerSemester(offer ?? [], semester);
    const currentPeriod = currentCurriculumPeriod(
        user?.entry_semester,
        getCurrentSemester()?.semester
    );
    // Texto aplicado após o debounce de 300 ms; inválido mantém o anterior.
    const [text, setText] = useState(() => searchText(q));
    useEffect(() => {
        const timer = setTimeout(() => setText((previous) => searchText(q, previous)), 300);
        return () => clearTimeout(timer);
    }, [q]);
    const view = searchView(category, q, text, user);
    const { data: history } = useQuery({
        ...allClassroomsQueryOptions,
        enabled: subjects && Boolean(user)
    });
    const { codes: manual } = useCompletedSubjects();
    // as marcadas como concluídas no fluxo também contam como cursadas
    const taken = useMemo(
        () => (history ? new Set([...takenCodes(history), ...manual]) : null),
        [history, manual]
    );
    return (
        <div className="flex flex-col gap-5">
            <div className="relative">
                <Search
                    className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                />
                <Input
                    type="search"
                    value={q}
                    onChange={(event) => {
                        const value = event.target.value.slice(0, SEARCH_MAX_LENGTH);
                        void setSearch({ q: value.trim() ? value : null });
                    }}
                    maxLength={SEARCH_MAX_LENGTH}
                    placeholder="Busque por matéria, curso ou professor..."
                    aria-label="Busque por matéria, curso ou professor"
                    className="h-11 bg-card pl-10 text-sm"
                />
            </div>
            <TabFilter
                label="Categoria da busca"
                value={category}
                options={SEARCH_CATEGORIES}
                labels={searchCategoryLabels}
                onChange={(value) => void setSearch({ category: value })}
                className="-my-2"
            />
            {subjects && (view?.kind === 'search' || view?.kind === 'unit') && (
                <OfferSemesterBar
                    choices={choices}
                    selected={selected}
                    onChange={(value) =>
                        void setSearch({ semester: value === choices[0]?.semester ? null : value })
                    }
                />
            )}
            <SchedulePreview />
            <div aria-live="polite" className="flex flex-col gap-5 pb-8">
                {!view && (
                    <p className="py-8 text-center text-sm text-muted-foreground">{`Digite de ${SEARCH_MIN_LENGTH} a ${SEARCH_MAX_LENGTH} caracteres do nome, código da matéria, curso ou professor para ver os resultados.`}</p>
                )}
                {subjects && !user && text && (
                    <p className="text-sm text-muted-foreground">
                        <Link className="font-bold text-primary hover:underline" to="/login">
                            Entre na sua conta
                        </Link>{' '}
                        para visualizar seu fluxo.
                    </p>
                )}
                {view?.kind === 'recommendations' && (
                    <>
                        <PlanningGuide choices={choices} />
                        <RecommendationsSection currentPeriod={currentPeriod} taken={taken} />
                    </>
                )}
                {view?.kind === 'search' && (
                    <SearchResults
                        key={category}
                        text={view.text}
                        types={searchTypes[category]}
                        empty={searchEmptyMessages[category]}
                        currentPeriod={currentPeriod}
                        taken={taken}
                        semester={apiSemester}
                        onShowCategory={
                            category === 'all'
                                ? (value) => void setSearch({ category: value })
                                : undefined
                        }
                    />
                )}
                {view?.kind === 'catalog' && <CatalogResults category={view.category} />}
                {view?.kind === 'unit' && (
                    <SubjectResults
                        unit={view.unit}
                        currentPeriod={currentPeriod}
                        taken={taken}
                        semester={apiSemester}
                    />
                )}
            </div>
        </div>
    );
}
