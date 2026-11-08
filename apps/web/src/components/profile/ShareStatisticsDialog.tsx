import { ChartPie, ShieldCheck } from 'lucide-react';

import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle
} from '#/components/ui/alert-dialog';
import { Button } from '#/components/ui/button';

interface ShareStatisticsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    pending: boolean;
    onShare: () => void;
    // só no convite ao abrir o app: "não compartilhar e não perguntar de novo"
    onNever?: () => void;
}

/** Pede para compartilhar os índices das turmas, deixando claro que nada pessoal vai junto. */
export function ShareStatisticsDialog({
    open,
    onOpenChange,
    pending,
    onShare,
    onNever
}: ShareStatisticsDialogProps) {
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Compartilhar os índices das suas turmas?</AlertDialogTitle>
                    <AlertDialogDescription render={<div />}>
                        <ShareStatisticsExplanation />
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="flex-col gap-2 sm:flex-col">
                    <Button disabled={pending} onClick={onShare}>
                        {pending ? 'Ativando...' : 'Compartilhar'}
                    </Button>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Agora não
                    </Button>
                    {onNever && (
                        <Button
                            variant="ghost"
                            className="text-muted-foreground"
                            disabled={pending}
                            onClick={onNever}
                        >
                            Não compartilhar e não perguntar de novo
                        </Button>
                    )}
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

export function ShareStatisticsExplanation() {
    return (
        <div className="flex flex-col gap-3 text-left text-sm">
            <p className="flex gap-2 rounded-xl bg-primary/10 p-3 text-foreground">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <span>
                    <strong className="font-semibold">Nenhum dado pessoal vai junto:</strong> nem
                    seu nome, matrícula, menção ou frequência.
                </span>
            </p>
            <p className="flex gap-2 text-muted-foreground">
                <ChartPie className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                <span>
                    Vão{' '}
                    <strong className="font-semibold text-foreground">
                        só as estatísticas gerais das turmas que você cursou
                    </strong>
                    : quantos foram aprovados, reprovados ou trancaram. Somando vários alunos, o
                    Followw mostra a reprovação de cada matéria e a média de cada professor.
                </span>
            </p>
            <p className="text-xs text-muted-foreground">
                Você pode desativar quando quiser em <strong>Perfil › Conta</strong>.
            </p>
        </div>
    );
}
