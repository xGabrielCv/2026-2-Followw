import { Flag } from 'lucide-react';
import { useState } from 'react';

import type { ReportReason, ReportTarget } from '#/queries/community';

import { TabFilter } from '#/components/TabFilter';
import { Button } from '#/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '#/components/ui/dialog';
import { Label } from '#/components/ui/label';
import { Textarea } from '#/components/ui/textarea';
import { cn } from '#/lib/shadcn';
import { useReport } from '#/queries/community';

export const REASONS: ReportReason[] = [
    'ofensivo',
    'dados_pessoais',
    'falso',
    'spam',
    'direitos_autorais',
    'outro'
];
export const REASON_LABELS: Record<ReportReason, string> = {
    ofensivo: 'Ofensivo',
    dados_pessoais: 'Expõe alguém',
    falso: 'Falso',
    spam: 'Spam',
    direitos_autorais: 'Direitos autorais',
    outro: 'Outro'
};

interface ReportButtonProps {
    target: ReportTarget;
    id: string;
    // o que está sendo denunciado, para o título ("esta avaliação")
    what: string;
    className?: string;
}

/** Denunciar ou pedir a exclusão: vai para a moderação, que decide. Não precisa de conta. */
export function ReportButton({ target, id, what, className }: ReportButtonProps) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className={cn(
                    'inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-destructive',
                    className
                )}
                aria-label={`Denunciar ou pedir exclusão de ${what}`}
                title="Denunciar ou pedir exclusão"
            >
                <Flag className="size-3.5" aria-hidden="true" />
            </button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Denunciar ou pedir exclusão</DialogTitle>
                        <DialogDescription>
                            O pedido sobre {what} vai para a moderação do Followw, que decide se
                            apaga. Não guardamos quem pediu.
                        </DialogDescription>
                    </DialogHeader>
                    {open && <ReportForm target={target} id={id} onDone={() => setOpen(false)} />}
                </DialogContent>
            </Dialog>
        </>
    );
}

export function ReportForm({
    target,
    id,
    onDone
}: {
    target: ReportTarget;
    id: string;
    onDone: () => void;
}) {
    const [reason, setReason] = useState<ReportReason>('ofensivo');
    const [message, setMessage] = useState('');
    const report = useReport();

    if (report.isSuccess)
        return (
            <div className="flex flex-col gap-3">
                <p className="rounded-xl bg-primary/10 p-3 text-sm">
                    Pedido enviado. A moderação vai analisar e, se for o caso, apagar o conteúdo.
                </p>
                <DialogFooter>
                    <Button onClick={onDone}>Fechar</Button>
                </DialogFooter>
            </div>
        );

    return (
        <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
                event.preventDefault();
                if (report.isPending) return;
                report.mutate({
                    body: {
                        target_type: target,
                        target_id: id,
                        reason,
                        message: message.trim() || null
                    }
                });
            }}
        >
            <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">Motivo</span>
                <TabFilter
                    label="Motivo"
                    value={reason}
                    options={REASONS}
                    labels={REASON_LABELS}
                    onChange={setReason}
                    className="flex-wrap"
                />
            </div>
            <div className="flex flex-col gap-2">
                <Label htmlFor="report-message">Explique (opcional)</Label>
                <Textarea
                    id="report-message"
                    value={message}
                    maxLength={500}
                    placeholder="Ex.: sou o docente e o comentário é ofensivo."
                    onChange={(event) => setMessage(event.target.value)}
                />
            </div>
            {report.isError && (
                <p role="alert" className="text-xs text-destructive">
                    Não foi possível enviar. Tente novamente.
                </p>
            )}
            <DialogFooter>
                <Button type="button" variant="ghost" onClick={onDone}>
                    Cancelar
                </Button>
                <Button type="submit" variant="destructive" disabled={report.isPending}>
                    {report.isPending ? 'Enviando...' : 'Enviar pedido'}
                </Button>
            </DialogFooter>
        </form>
    );
}
