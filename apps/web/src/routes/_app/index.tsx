import { noop, useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { getNoClassReason } from '#/calendar';
import { ErrorState } from '#/components/ErrorState';
import { HeaderBar, HeaderTitle } from '#/components/HeaderBar';
import { DayAgenda } from '#/components/home/DayAgenda';
import { DaySummary } from '#/components/home/DaySummary';
import { HomeInsights } from '#/components/home/HomeInsights';
import { LatestNewsSection } from '#/components/home/LatestNewsSection';
import { PublicInfoSection } from '#/components/home/PublicInfoSection';
import { RemindersSection } from '#/components/home/RemindersSection';
import { usePageState } from '#/components/PageState';
import { useAgenda } from '#/components/schedule/useAgenda';
import { academicEventsOn, entriesOn } from '#/lib/agenda';
import { dayOverview, nowInBrasilia } from '#/lib/schedule';
import { publicPageHead } from '#/lib/seo';
import { classroomsQueryOptions } from '#/queries/classrooms';
import { useCalendarEntries } from '#/queries/events';
import { loadPersonal, loadQuery } from '#/queries/load';
import { meQueryOptions } from '#/queries/me';
import { campusOf, menuQueryOptions } from '#/queries/restaurant';

const WEEKDAYS = [
    'Domingo',
    'Segunda-feira',
    'Terça-feira',
    'Quarta-feira',
    'Quinta-feira',
    'Sexta-feira',
    'Sábado'
];

export const Route = createFileRoute('/_app/')({
    head: () => ({
        ...publicPageHead({
            path: '/',
            title: 'Followw — SIGAA UnB e cardápio do RU',
            description:
                'Acompanhe suas turmas, horários e postagens do SIGAA, consulte o cardápio do RU e muito mais.'
        }),
        scripts: [
            {
                type: 'application/ld+json',
                children: JSON.stringify({
                    '@context': 'https://schema.org',
                    '@type': 'WebSite',
                    name: 'Followw',
                    alternateName: 'Followw UnB',
                    url: 'https://followw.app/'
                })
            }
        ]
    }),
    loader: async ({ context: { queryClient } }) => {
        const now = nowInBrasilia();
        const user = await loadQuery(queryClient, meQueryOptions);
        await Promise.all([
            loadQuery(queryClient, menuQueryOptions({ date: now.date, user })).catch(noop),
            user && loadPersonal(queryClient, classroomsQueryOptions)
        ]);
        return { now };
    },
    staticData: { header: HomeHeader, wide: true },
    errorComponent: ErrorState,
    component: HomePage
});

function useNow() {
    // sem loaderData quando a rota falha, e o header ainda renderiza
    const loaded = Route.useLoaderData({ select: (data) => data?.now });
    const [now, setNow] = useState(() => loaded ?? nowInBrasilia());
    useEffect(() => {
        const id = setInterval(() => setNow(nowInBrasilia()), 30_000);
        return () => clearInterval(id);
    }, []);
    return now;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function useSelectedDay() {
    const now = useNow();
    const [picked, setPicked] = usePageState('date', null);
    const date = typeof picked === 'string' && DATE.test(picked) ? picked : now.date;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const isToday = date === now.date;
    const label = isToday ? 'Hoje' : WEEKDAYS[weekday];
    const select = (next: string) => setPicked(next === now.date ? null : next);
    return { now, date, weekday, isToday, label, select };
}

function HomeHeader() {
    const { label } = useSelectedDay();
    return (
        <HeaderBar>
            <HeaderTitle>{label}</HeaderTitle>
        </HeaderBar>
    );
}

function HomePage() {
    const { now, date, isToday, label, select } = useSelectedDay();

    const { data: user } = useSuspenseQuery(meQueryOptions);
    const classroomsQuery = useQuery({
        ...classroomsQueryOptions,
        enabled: Boolean(user)
    });
    const classrooms = classroomsQuery.data ?? [];
    const menu = useQuery(menuQueryOptions({ date, user }));
    const entries = useCalendarEntries().data ?? [];

    const agendaOf = useAgenda(classrooms);
    const noClassReason = getNoClassReason(date);
    const { classes, preview, colorOf } = agendaOf(date, isToday ? now.time : undefined);

    const overview = dayOverview(classes, isToday ? now.time : undefined);
    // RU, semestre e desempenho: à direita no computador, no fim da página no celular
    const side = (
        <>
            <PublicInfoSection
                campus={campusOf(user?.unit?.code)}
                menu={menu.data?.[0]}
                isLoading={menu.isPending}
                day={label}
            />
            <HomeInsights date={date} user={user} classrooms={classroomsQuery.data} />
        </>
    );

    return (
        <div className="flex flex-col gap-6 desk:grid desk:grid-cols-[minmax(0,1fr)_22rem] desk:items-start desk:gap-8">
            <div className="flex min-w-0 flex-col gap-6">
                {user && <LatestNewsSection />}
                <DayAgenda
                    date={date}
                    today={now.date}
                    onSelect={select}
                    loggedIn={Boolean(user)}
                    noClassReason={noClassReason}
                    isLoadingError={classroomsQuery.isLoadingError}
                    onRetry={() => void classroomsQuery.refetch()}
                    classes={classes}
                    preview={preview}
                    entries={entriesOn(entries, date)}
                    academic={academicEventsOn(date)}
                    colorOf={colorOf}
                />
                {user && classes.length > 0 && <DaySummary overview={overview} isToday={isToday} />}
                <RemindersSection entries={entries} today={now.date} />
                <div className="flex flex-col gap-6 desk:hidden">{side}</div>
            </div>
            <aside aria-label="Resumo" className="hidden flex-col gap-6 desk:flex">
                {side}
            </aside>
        </div>
    );
}
