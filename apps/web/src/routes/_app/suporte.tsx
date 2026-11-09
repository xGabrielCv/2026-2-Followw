import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Copy, KeyRound, LifeBuoy, Plus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { BackHeader } from '#/components/HeaderBar';
import { TabFilter } from '#/components/TabFilter';
import { Badge } from '#/components/ui/badge';
import { Button } from '#/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '#/components/ui/dialog';
import { Input } from '#/components/ui/input';
import { Label } from '#/components/ui/label';
import { Textarea } from '#/components/ui/textarea';
import { useOnline } from '#/lib/online';
import {
    hasPersonalData,
    OPEN_STATUSES,
    TICKET_CATEGORIES,
    TICKET_CATEGORY_LABELS,
    TICKET_STATUS_LABELS,
    type TicketCategory
} from '#/lib/support';
import { apiMessage } from '#/queries/community';
import {
    rememberTicket,
    recoverTicketKey,
    ticketQueryOptions,
    useCreateTicket,
    useOwnTickets,
    type OwnTicket
} from '#/queries/support';

export const Route = createFileRoute('/_app/suporte')({
    head: () => ({ meta: [{ title: 'Suporte e ajuda | Followw' }] }),
    staticData: {
        header: () => <BackHeader to="/mais" title="Suporte e ajuda" />
    },
    component: SupportPage
});

function SupportPage() {
    const navigate = useNavigate();
    const tickets = useOwnTickets();
    const [creating, setCreating] = useState(false);
    const [recovering, setRecovering] = useState(false);
    const [created, setCreated] = useState<{ id: string; number: number; code: string } | null>(
        null
    );

    return (
        <div className="flex flex-col gap-4 pb-8">
            <p className="flex gap-2 rounded-xl bg-primary/10 p-3 text-xs">
                <ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden="true" />
                <span>
                    <strong className="font-semibold">Sem login e sem identificação.</strong> O
                    chamado não guarda matrícula, nome ou e-mail. Só este aparelho tem a chave para
                    acompanhá-lo; guarde o código de recuperação para abrir em outro.
                </span>
            </p>
            <div className="flex gap-2">
                <Button className="flex-1" onClick={() => setCreating(true)}>
                    <Plus aria-hidden /> Novo chamado
                </Button>
                <Button variant="outline" onClick={() => setRecovering(true)}>
                    <KeyRound aria-hidden /> Recuperar
                </Button>
            </div>
            {tickets.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-2xl bg-card p-6 text-center">
                    <LifeBuoy className="size-8 text-primary" aria-hidden="true" />
                    <p className="text-sm font-semibold">Nenhum chamado neste aparelho</p>
                    <p className="text-sm text-muted-foreground">
                        Relate um problema, mande uma sugestão ou peça ajuda. Para denunciar um
                        conteúdo, use o botão de denúncia na própria publicação.
                    </p>
                </div>
            ) : (
                <ul className="flex flex-col gap-2">
                    {tickets.map((ticket) => (
                        <TicketRow key={ticket.id} ticket={ticket} />
                    ))}
                </ul>
            )}
            <NewTicketDialog
                open={creating}
                onOpenChange={setCreating}
                onCreated={(id, number, code) => setCreated({ id, number, code })}
            />
            <RecoverDialog open={recovering} onOpenChange={setRecovering} />
            <CodeDialog
                created={created}
                onClose={() => {
                    const id = created?.id;
                    setCreated(null);
                    if (id) void navigate({ to: '/suporte/$id', params: { id } });
                }}
            />
        </div>
    );
}

function TicketRow({ ticket }: { ticket: OwnTicket }) {
    const { data } = useQuery(ticketQueryOptions(ticket.id, ticket.key));
    const unread = data ? data.message_count > ticket.seen : false;
    const open = !data || OPEN_STATUSES.includes(data.status);
    return (
        <li>
            <Link
                to="/suporte/$id"
                params={{ id: ticket.id }}
                className="flex items-center gap-3 rounded-2xl bg-card p-4 shadow-card ring-1 ring-foreground/8 hover:ring-primary/40"
            >
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-sm font-semibold">{ticket.title}</span>
                    <span className="text-xs text-muted-foreground">
                        Chamado #{ticket.number} ·{' '}
                        {new Date(ticket.createdAt).toLocaleDateString('pt-BR')}
                    </span>
                </span>
                {unread && <Badge>Nova resposta</Badge>}
                <Badge variant={open ? 'secondary' : 'outline'}>
                    {data ? TICKET_STATUS_LABELS[data.status] : '…'}
                </Badge>
            </Link>
        </li>
    );
}

function NewTicketDialog({
    open,
    onOpenChange,
    onCreated
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated: (id: string, number: number, code: string) => void;
}) {
    const [category, setCategory] = useState<TicketCategory>('bug');
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const online = useOnline();
    const create = useCreateTicket();
    const personal = hasPersonalData(title, body);
    const valid = title.trim().length >= 5 && body.trim().length >= 5 && !personal;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Novo chamado</DialogTitle>
                    <DialogDescription>
                        Não informe matrícula, CPF, e-mail ou senha.
                    </DialogDescription>
                </DialogHeader>
                <form
                    className="flex flex-col gap-3"
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (!valid || create.isPending) return;
                        create.mutate(
                            { body: { category, title: title.trim(), body: body.trim() } },
                            {
                                onSuccess: (data) => {
                                    rememberTicket({
                                        id: data.id,
                                        number: data.number,
                                        key: data.key,
                                        title: title.trim(),
                                        createdAt: new Date().toISOString(),
                                        seen: 1
                                    });
                                    onCreated(data.id, data.number, data.recovery_code);
                                    setTitle('');
                                    setBody('');
                                    onOpenChange(false);
                                }
                            }
                        );
                    }}
                >
                    <div className="flex flex-col gap-1">
                        <span className="text-sm font-medium">Assunto</span>
                        <TabFilter
                            label="Assunto"
                            value={category}
                            options={TICKET_CATEGORIES}
                            labels={TICKET_CATEGORY_LABELS}
                            onChange={setCategory}
                            className="flex-wrap"
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="ticket-title">Título</Label>
                        <Input
                            id="ticket-title"
                            value={title}
                            maxLength={120}
                            onChange={(event) => setTitle(event.target.value)}
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="ticket-body">Mensagem</Label>
                        <Textarea
                            id="ticket-body"
                            value={body}
                            rows={5}
                            maxLength={4000}
                            onChange={(event) => setBody(event.target.value)}
                        />
                    </div>
                    {personal && (
                        <p role="alert" className="text-xs text-destructive">
                            Parece haver CPF, e-mail ou matrícula no texto. Remova para continuar.
                        </p>
                    )}
                    {create.isError && (
                        <p role="alert" className="text-xs text-destructive">
                            {apiMessage(create.error, 'Não foi possível abrir o chamado agora.')}
                        </p>
                    )}
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Voltar
                        </Button>
                        <Button type="submit" disabled={!valid || !online || create.isPending}>
                            {online ? 'Enviar' : 'Sem conexão'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function CodeDialog({
    created,
    onClose
}: {
    created: { id: string; number: number; code: string } | null;
    onClose: () => void;
}) {
    return (
        <Dialog open={created !== null} onOpenChange={(open) => !open && onClose()}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Chamado #{created?.number} aberto</DialogTitle>
                    <DialogDescription>
                        Guarde este código. Ele aparece só agora e é a única forma de abrir o
                        chamado em outro aparelho ou depois de limpar os dados do navegador. Não
                        existe recuperação por matrícula.
                    </DialogDescription>
                </DialogHeader>
                <p className="rounded-xl bg-muted p-3 text-center font-mono text-lg tracking-wider">
                    {created?.code}
                </p>
                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => void navigator.clipboard?.writeText(created?.code ?? '')}
                    >
                        <Copy aria-hidden /> Copiar
                    </Button>
                    <Button onClick={onClose}>Já guardei</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function RecoverDialog({
    open,
    onOpenChange
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const [id, setId] = useState('');
    const [code, setCode] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    const navigate = useNavigate();

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Recuperar chamado</DialogTitle>
                    <DialogDescription>
                        Informe o identificador do chamado (a parte final do endereço da página) e o
                        código de recuperação.
                    </DialogDescription>
                </DialogHeader>
                <form
                    className="flex flex-col gap-3"
                    onSubmit={(event) => {
                        event.preventDefault();
                        setPending(true);
                        setError(null);
                        void (async () => {
                            try {
                                const key = await recoverTicketKey(id.trim(), code.trim());
                                if (!key) {
                                    setError('Chamado ou código inválido.');
                                    return;
                                }
                                rememberTicket({
                                    id: id.trim(),
                                    number: 0,
                                    key,
                                    title: 'Chamado recuperado',
                                    createdAt: new Date().toISOString(),
                                    seen: 0
                                });
                                onOpenChange(false);
                                await navigate({ to: '/suporte/$id', params: { id: id.trim() } });
                            } catch (failure) {
                                setError(apiMessage(failure, 'Chamado ou código inválido.'));
                            } finally {
                                setPending(false);
                            }
                        })();
                    }}
                >
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="recover-id">Identificador</Label>
                        <Input
                            id="recover-id"
                            value={id}
                            onChange={(event) => setId(event.target.value)}
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="recover-code">Código de recuperação</Label>
                        <Input
                            id="recover-code"
                            value={code}
                            placeholder="XXXX-XXXX-XXXX-XXXX"
                            onChange={(event) => setCode(event.target.value)}
                        />
                    </div>
                    {error && (
                        <p role="alert" className="text-xs text-destructive">
                            {error}
                        </p>
                    )}
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Voltar
                        </Button>
                        <Button type="submit" disabled={pending || !id.trim() || !code.trim()}>
                            Recuperar
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
