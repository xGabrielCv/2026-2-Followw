import { CheckCircle2, ExternalLink, ShieldCheck, XCircle } from 'lucide-react';

import { Button, buttonVariants } from '#/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '#/components/ui/dialog';

export interface ToolInfo {
    title: string;
    summary: string;
    does: string[];
    doesNot: string[];
    stores: string;
    openLabel: string;
    // sem link, a ferramenta aparece como "em breve"
    href: string | null;
}

export const TOOLS: Record<'automatricula' | 'monitor', Omit<ToolInfo, 'href'>> = {
    automatricula: {
        title: 'Automatrícula UnB',
        summary:
            'Projeto aberto (SIGAA Sniper) que acompanha as turmas que você escolher na matrícula extraordinária e avisa quando abre vaga, ou tenta a matrícula por você.',
        does: [
            'Roda no seu computador (Windows), com interface web local, janela ou terminal.',
            'Começa só monitorando e com teste sem matricular (DRY RUN) ligado.',
            'Avisa por Telegram, ntfy, e-mail, Windows ou alarme, como você configurar.'
        ],
        doesNot: [
            'Não é do Followw nem da UnB: é um projeto separado, de código aberto.',
            'Não manda sua senha para nenhum servidor além do próprio SIGAA.',
            'Não deve ser usado para burlar filas, regras ou limites do SIGAA.'
        ],
        stores: 'Suas credenciais e o histórico das execuções ficam só no seu computador, com dados pessoais mascarados nos registros. O uso é por sua conta e risco.',
        openLabel: 'Abrir repositório'
    },
    monitor: {
        title: 'Monitor de vagas (Telegram)',
        summary:
            'Bot do Telegram que avisa quando abre vaga nas turmas que você acompanha durante a matrícula extraordinária.',
        does: [
            'Consulta as vagas públicas das turmas, como a busca pública de turmas do SIGAA.',
            'Manda uma mensagem no Telegram quando uma vaga abre.'
        ],
        doesNot: [
            'Não pede sua matrícula nem sua senha do SIGAA.',
            'Não usa dados pessoais e não matricula você.',
            'Não é da UnB: é uma ferramenta da comunidade.'
        ],
        stores: 'Só as turmas que você pediu para acompanhar e o seu chat do Telegram, para mandar o aviso.',
        openLabel: 'Abrir no Telegram'
    }
};

/** Explica a ferramenta antes de sair do Followw: o que faz, o que não faz e o que guarda. */
export function ToolDialog({
    tool,
    open,
    onOpenChange
}: {
    tool: ToolInfo;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{tool.title}</DialogTitle>
                    <DialogDescription>{tool.summary}</DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-3 text-sm">
                    <ToolList title="O que faz" items={tool.does} icon="ok" />
                    <ToolList title="O que não faz" items={tool.doesNot} icon="no" />
                    <div className="flex gap-2 rounded-xl bg-primary/5 p-3">
                        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                        <p>
                            <span className="font-semibold">O que guarda: </span>
                            <span className="text-muted-foreground">{tool.stores}</span>
                        </p>
                    </div>
                    {!tool.href && (
                        <p className="rounded-xl bg-warning/10 p-3 text-warning">
                            Em breve: o link ainda não foi liberado.
                        </p>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Voltar
                    </Button>
                    {tool.href ? (
                        <a
                            href={tool.href}
                            target="_blank"
                            rel="external noopener noreferrer"
                            className={buttonVariants()}
                            onClick={() => onOpenChange(false)}
                        >
                            {tool.openLabel}
                            <ExternalLink aria-hidden />
                        </a>
                    ) : (
                        <Button disabled>{tool.openLabel}</Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function ToolList({ title, items, icon }: { title: string; items: string[]; icon: 'ok' | 'no' }) {
    const Icon = icon === 'ok' ? CheckCircle2 : XCircle;
    return (
        <section>
            <h3 className="mb-1 font-semibold">{title}</h3>
            <ul className="flex flex-col gap-1">
                {items.map((item) => (
                    <li key={item} className="flex gap-2 text-muted-foreground">
                        <Icon
                            className={
                                icon === 'ok'
                                    ? 'mt-0.5 size-4 shrink-0 text-primary'
                                    : 'mt-0.5 size-4 shrink-0 text-destructive'
                            }
                            aria-hidden
                        />
                        {item}
                    </li>
                ))}
            </ul>
        </section>
    );
}
