import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import type { TutorialCategory } from '#/queries/community';

import { ErrorState } from '#/components/ErrorState';
import { BackHeader } from '#/components/HeaderBar';
import { LoginPromptCard } from '#/components/home/LoginPromptCard';
import { TabFilter } from '#/components/TabFilter';
import { Button, buttonVariants } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { Label } from '#/components/ui/label';
import { Textarea } from '#/components/ui/textarea';
import { Markdown } from '#/lib/markdown';
import { useOnline } from '#/lib/online';
import { TUTORIAL_CATEGORIES, TUTORIAL_CATEGORY_LABELS } from '#/lib/tutorials';
import { apiMessage, useSubmitTutorial } from '#/queries/community';
import { meQueryOptions } from '#/queries/me';

export const Route = createFileRoute('/_app/guias_/novo')({
    head: () => ({ meta: [{ title: 'Escrever guia | Followw' }] }),
    staticData: {
        header: () => <BackHeader to="/guias" title="Escrever guia" />
    },
    errorComponent: ErrorState,
    component: NovoGuiaPage
});

function NovoGuiaPage() {
    const { data: user } = useSuspenseQuery(meQueryOptions);
    return user ? <TutorialForm /> : <LoginPromptCard />;
}

export function TutorialForm() {
    const [title, setTitle] = useState('');
    const [summary, setSummary] = useState('');
    const [body, setBody] = useState('');
    const [category, setCategory] = useState<TutorialCategory>('matricula');
    const [preview, setPreview] = useState(false);
    const submit = useSubmitTutorial();
    const online = useOnline();
    const valid =
        title.trim().length >= 5 && summary.trim().length >= 10 && body.trim().length >= 50;

    if (submit.isSuccess)
        return (
            <div className="flex flex-col items-center gap-3 rounded-2xl bg-card p-6 text-center">
                <CheckCircle2 className="size-8 text-primary" aria-hidden="true" />
                <p className="text-sm font-semibold">Guia enviado para a moderação!</p>
                <p className="text-sm text-muted-foreground">
                    Ele aparece na lista assim que for aprovado. Obrigado por ajudar quem está
                    chegando.
                </p>
                <Link to="/guias" className={buttonVariants({ variant: 'outline' })}>
                    Voltar aos guias
                </Link>
            </div>
        );

    return (
        <form
            className="flex flex-col gap-4 pb-8"
            onSubmit={(event) => {
                event.preventDefault();
                if (!valid || submit.isPending) return;
                submit.mutate({
                    body: {
                        title: title.trim(),
                        summary: summary.trim(),
                        body: body.trim(),
                        category
                    }
                });
            }}
        >
            <p className="flex gap-2 rounded-xl bg-primary/10 p-3 text-xs">
                <ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden="true" />
                <span>
                    <strong className="font-semibold">O guia não leva seu nome.</strong> Ele passa
                    pela moderação antes de aparecer para todos. Escreva o passo a passo como você
                    gostaria de ter lido quando entrou.
                </span>
            </p>
            <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">Categoria</span>
                <TabFilter
                    label="Categoria"
                    value={category}
                    options={TUTORIAL_CATEGORIES}
                    labels={TUTORIAL_CATEGORY_LABELS}
                    onChange={setCategory}
                    className="flex-wrap"
                />
            </div>
            <div className="flex flex-col gap-2">
                <Label htmlFor="tutorial-title">Título</Label>
                <Input
                    id="tutorial-title"
                    value={title}
                    maxLength={100}
                    placeholder="Ex.: Como pedir dispensa do estágio obrigatório"
                    onChange={(event) => setTitle(event.target.value)}
                />
            </div>
            <div className="flex flex-col gap-2">
                <Label htmlFor="tutorial-summary">Resumo</Label>
                <Input
                    id="tutorial-summary"
                    value={summary}
                    maxLength={240}
                    placeholder="Em uma frase, do que o guia trata"
                    onChange={(event) => setSummary(event.target.value)}
                />
            </div>
            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                    <Label htmlFor="tutorial-body">Passo a passo</Label>
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setPreview(!preview)}
                    >
                        {preview ? 'Editar' : 'Ver como fica'}
                    </Button>
                </div>
                {preview ? (
                    <div className="min-h-40 rounded-xl bg-card p-3 text-sm ring-1 ring-foreground/8">
                        <Markdown community>{body || '_Nada escrito ainda._'}</Markdown>
                    </div>
                ) : (
                    <Textarea
                        id="tutorial-body"
                        value={body}
                        maxLength={20000}
                        className="min-h-56"
                        placeholder={
                            '## Antes de começar\n\n1. Primeiro passo...\n2. Segundo passo...'
                        }
                        onChange={(event) => setBody(event.target.value)}
                    />
                )}
                <span className="text-xs text-muted-foreground">
                    Aceita Markdown: ## título, **negrito**, listas com 1. ou -. Mínimo de 50
                    caracteres.
                </span>
            </div>
            {submit.isError && (
                <p role="alert" className="text-xs text-destructive">
                    {apiMessage(submit.error, 'Não foi possível enviar. Tente novamente.')}
                </p>
            )}
            <Button type="submit" disabled={!valid || submit.isPending || !online}>
                {submit.isPending ? 'Enviando...' : 'Enviar para aprovação'}
            </Button>
        </form>
    );
}
