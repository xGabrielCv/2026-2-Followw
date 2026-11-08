import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';

import { ReportButton } from '#/components/community/ReportButton';
import { ErrorCard, ErrorState } from '#/components/ErrorState';
import { BackHeader } from '#/components/HeaderBar';
import { LoadingText } from '#/components/LoadingText';
import { Markdown } from '#/lib/markdown';
import { TUTORIAL_CATEGORY_LABELS } from '#/lib/tutorials';
import { tutorialQueryOptions } from '#/queries/community';

export const Route = createFileRoute('/_app/guias_/$id')({
    head: () => ({ meta: [{ title: 'Guia | Followw' }] }),
    staticData: {
        header: () => <BackHeader to="/guias" title="Guia" />
    },
    errorComponent: ErrorState,
    component: GuiaPage
});

const published = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' });

function GuiaPage() {
    const { id } = Route.useParams();
    const tutorial = useQuery(tutorialQueryOptions(id));
    if (tutorial.isPending) return <LoadingText>Carregando guia...</LoadingText>;
    if (tutorial.isError)
        return <ErrorCard message="Guia não encontrado." onRetry={() => tutorial.refetch()} />;
    const { title, summary, body, category, published_at: at } = tutorial.data;

    return (
        <article className="flex flex-col gap-3 pb-8">
            <header className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-primary">
                    {TUTORIAL_CATEGORY_LABELS[category]}
                </span>
                <h1 className="text-xl leading-tight font-semibold tracking-tight text-balance">
                    {title}
                </h1>
                <p className="text-sm text-muted-foreground">{summary}</p>
                {at && (
                    <span className="text-xs text-muted-foreground">
                        Publicado em {published.format(new Date(at))} · escrito pela comunidade
                    </span>
                )}
            </header>
            <div className="rounded-2xl bg-card p-4 text-sm shadow-card ring-1 ring-foreground/8">
                <Markdown community>{body}</Markdown>
            </div>
            <p className="flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
                Algo errado ou desatualizado? Avise a moderação.
                <ReportButton target="tutorial" id={id} what="este guia" />
            </p>
        </article>
    );
}
