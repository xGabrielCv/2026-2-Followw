import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { BackHeader } from '#/components/HeaderBar';
import { Badge } from '#/components/ui/badge';
import { Button, buttonVariants } from '#/components/ui/button';
import { Textarea } from '#/components/ui/textarea';
import { cn } from '#/lib/shadcn';
import { hasPersonalData, TICKET_CATEGORY_LABELS, TICKET_STATUS_LABELS } from '#/lib/support';
import { apiMessage } from '#/queries/community';
import {
    forgetTicket,
    markSeen,
    ticketQueryOptions,
    useOwnTickets,
    useTicketAction
} from '#/queries/support';

export const Route = createFileRoute('/_app/suporte_/$id')({
    head: () => ({ meta: [{ title: 'Chamado | Followw' }] }),
    staticData: {
        header: () => <BackHeader to="/suporte" title="Chamado" />
    },
    component: TicketPage
});

function TicketPage() {
    const { id } = Route.useParams();
    const own = useOwnTickets().find((ticket) => ticket.id === id);
    if (!own)
        return (
            <div className="flex flex-col gap-3 rounded-2xl bg-card p-6 text-center">
                <p className="text-sm font-semibold">Este aparelho não tem a chave deste chamado</p>
                <p className="text-sm text-muted-foreground">
                    Use o código de recuperação para abrir um chamado em outro aparelho.
                </p>
                <Link to="/suporte" className={buttonVariants({ variant: 'outline' })}>
                    Voltar ao suporte
                </Link>
            </div>
        );
    return <TicketThread id={id} secret={own.key} />;
}

function TicketThread({ id, secret }: { id: string; secret: string }) {
    const { data: ticket, isPending, isError } = useQuery(ticketQueryOptions(id, secret));
    const reply = useTicketAction(id, secret, 'messages');
    const close = useTicketAction(id, secret, 'close');
    const reopen = useTicketAction(id, secret, 'reopen');
    const [body, setBody] = useState('');

    useEffect(() => {
        if (ticket) markSeen(id, ticket.message_count);
    }, [id, ticket]);

    if (isPending) return <p className="text-sm text-muted-foreground">Carregando…</p>;
    if (isError || !ticket)
        return (
            <div className="flex flex-col gap-3 rounded-2xl bg-card p-6 text-center">
                <p className="text-sm font-semibold">Não foi possível abrir este chamado</p>
                <p className="text-sm text-muted-foreground">
                    A chave pode ter sido trocada pela recuperação, ou o chamado não existe mais.
                </p>
                <Button variant="outline" onClick={() => forgetTicket(id)}>
                    Remover deste aparelho
                </Button>
            </div>
        );

    const closed = ticket.status === 'closed';
    const personal = hasPersonalData(body);

    return (
        <div className="flex flex-col gap-4 pb-8">
            <header className="flex flex-col gap-2 rounded-2xl bg-card p-4 shadow-card ring-1 ring-foreground/8">
                <div className="flex items-start justify-between gap-2">
                    <h1 className="text-base leading-tight font-semibold">{ticket.title}</h1>
                    <Badge variant={closed ? 'outline' : 'secondary'}>
                        {TICKET_STATUS_LABELS[ticket.status]}
                    </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                    Chamado #{ticket.number} · {TICKET_CATEGORY_LABELS[ticket.category]} · aberto em{' '}
                    {new Date(ticket.created_at).toLocaleDateString('pt-BR')}
                </p>
                <p className="font-mono text-[11px] break-all text-muted-foreground">
                    Identificador: {ticket.id}
                </p>
            </header>
            <ol className="flex flex-col gap-3" aria-label="Mensagens">
                {ticket.category === 'moderation_review' && (
                    <li className="rounded-2xl bg-card p-4 text-sm">
                        <p>
                            {ticket.appeal_outcome === 'accepted'
                                ? 'Recurso aceito'
                                : ticket.appeal_outcome === 'rejected'
                                  ? 'Recurso não acolhido'
                                  : 'Recurso aguardando decisão'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                            {ticket.appeal_author_proven
                                ? 'Credencial de autoria comprovada.'
                                : 'Autoria não comprovada. Isso não impede a revisão.'}{' '}
                            Consulte a resposta da equipe para as medidas adotadas.
                        </p>
                    </li>
                )}
                {ticket.messages.map((message) => (
                    <li
                        key={message.id}
                        className={cn(
                            'max-w-[85%] rounded-2xl p-3 text-sm',
                            message.sender === 'student'
                                ? 'self-end bg-primary/10'
                                : 'self-start bg-card ring-1 ring-foreground/8'
                        )}
                    >
                        <p className="mb-1 text-[11px] font-semibold text-muted-foreground">
                            {message.sender === 'student' ? 'Você' : 'Atendimento'} ·{' '}
                            {new Date(message.created_at).toLocaleString('pt-BR')}
                        </p>
                        <p className="break-words whitespace-pre-wrap">{message.body}</p>
                    </li>
                ))}
            </ol>
            {!closed && (
                <form
                    className="flex flex-col gap-2"
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (body.trim().length < 5 || personal || reply.isPending) return;
                        reply.mutate({ body: body.trim() }, { onSuccess: () => setBody('') });
                    }}
                >
                    <Textarea
                        aria-label="Responder ao atendimento"
                        value={body}
                        rows={3}
                        maxLength={4000}
                        placeholder="Escreva sua resposta"
                        onChange={(event) => setBody(event.target.value)}
                    />
                    {personal && (
                        <p role="alert" className="text-xs text-destructive">
                            Remova CPF, e-mail ou matrícula do texto.
                        </p>
                    )}
                    {reply.isError && (
                        <p role="alert" className="text-xs text-destructive">
                            {apiMessage(reply.error, 'Não foi possível enviar agora.')}
                        </p>
                    )}
                    <div className="flex gap-2">
                        <Button
                            type="submit"
                            className="flex-1"
                            disabled={body.trim().length < 5 || personal || reply.isPending}
                        >
                            Enviar
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            disabled={close.isPending}
                            onClick={() => close.mutate(undefined)}
                        >
                            Encerrar chamado
                        </Button>
                    </div>
                </form>
            )}
            {ticket.can_reopen && (
                <Button
                    variant="outline"
                    disabled={reopen.isPending}
                    onClick={() => reopen.mutate(undefined)}
                >
                    Reabrir chamado
                </Button>
            )}
            {closed && !ticket.can_reopen && (
                <p className="text-xs text-muted-foreground">
                    Este chamado foi encerrado pelo atendimento. Abra um novo se precisar.
                </p>
            )}
        </div>
    );
}
