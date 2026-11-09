import { useQueryClient } from '@tanstack/react-query';
import { HardDrive } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '#/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from '#/components/ui/dialog';
import { clearOfflineData } from '#/integrations/offline/storage';
import { setAnalyticsConsent } from '#/integrations/posthog/provider';
import { localStorageRepository } from '#/lib/local-storage';
import { clearAcademicData, localVault, retentionDays, RETENTION_DAYS } from '#/lib/local-vault';

const megabytes = (bytes: number) =>
    `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;

/** Quanto tempo as informações acadêmicas ficam salvas neste navegador (sempre cifradas). */
export function StorageSetting() {
    const client = useQueryClient();
    const [days, setDays] = useState(30);
    const [usage, setUsage] = useState<number>();
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const [confirming, setConfirming] = useState(false);

    const measure = () =>
        void navigator.storage
            ?.estimate()
            .then(({ usage: bytes }) => setUsage(bytes))
            .catch(() => {});
    useEffect(measure, []);

    const save = async () => {
        setBusy(true);
        try {
            localStorageRepository.set('retention-days', days);
            await localVault(window.localStorage).flush();
            await client.cancelQueries();
            await clearOfflineData();
            setMessage('Prazo salvo.');
        } catch {
            setMessage('Não foi possível salvar. Seus dados foram mantidos.');
        } finally {
            setBusy(false);
        }
    };

    const clear = async () => {
        setBusy(true);
        try {
            await client.cancelQueries();
            client.clear();
            await clearOfflineData();
            // só o que é acadêmico: as chaves das suas publicações e chamados continuam
            await clearAcademicData(window.localStorage);
            setConfirming(false);
            setMessage('Informações acadêmicas apagadas deste navegador.');
            measure();
        } catch {
            setMessage('Não foi possível apagar agora.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog
            onOpenChange={(open) => {
                if (open) {
                    setDays(retentionDays(window.localStorage));
                    setMessage('');
                    setConfirming(false);
                    measure();
                }
            }}
        >
            <DialogTrigger
                render={
                    <Button
                        variant="ghost"
                        className="-mx-3 h-auto min-h-12 justify-start gap-3 px-3 py-2.5"
                    />
                }
            >
                <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <HardDrive className="size-4" aria-hidden="true" />
                </span>
                <span className="flex flex-1 flex-col text-left">
                    <span>Configurar armazenamento</span>
                    <span className="text-xs text-muted-foreground">
                        Por quanto tempo seus dados ficam salvos
                    </span>
                </span>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Configurar armazenamento</DialogTitle>
                    <DialogDescription>
                        Escolha por quanto tempo suas informações acadêmicas ficam salvas neste
                        navegador. Seus dados são armazenados de forma criptografada.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-4 text-sm">
                    <div className="flex flex-col gap-2">
                        <label htmlFor="retention-days" className="font-medium">
                            Guardar por
                        </label>
                        <select
                            id="retention-days"
                            value={days}
                            onChange={(event) => setDays(Number(event.target.value))}
                            className="h-10 rounded-lg border border-input bg-background px-3"
                        >
                            {RETENTION_DAYS.map((value) => (
                                <option key={value} value={value}>
                                    {value} dias{value === 30 ? ' (padrão)' : ''}
                                </option>
                            ))}
                        </select>
                        <Button disabled={busy} onClick={() => void save()}>
                            Salvar
                        </Button>
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="font-medium">Espaço utilizado</span>
                        <span className="text-muted-foreground">
                            {usage === undefined
                                ? 'Seus dados salvos ocupam um espaço que este navegador não informa.'
                                : `Seus dados salvos ocupam aproximadamente ${megabytes(usage)} neste navegador.`}
                        </span>
                    </div>
                    <div className="flex flex-col gap-2">
                        <span className="font-medium">Limpar dados</span>
                        {confirming ? (
                            <div
                                role="alertdialog"
                                aria-label="Confirmar limpeza"
                                className="flex flex-col gap-2 rounded-xl bg-destructive/10 p-3"
                            >
                                <p>
                                    Apagar as informações acadêmicas salvas neste navegador? Elas
                                    voltam na próxima vez que você entrar. Suas publicações e
                                    chamados não são afetados.
                                </p>
                                <DialogFooter>
                                    <Button
                                        variant="outline"
                                        disabled={busy}
                                        onClick={() => setConfirming(false)}
                                    >
                                        Cancelar
                                    </Button>
                                    <Button
                                        variant="destructive"
                                        disabled={busy}
                                        onClick={() => void clear()}
                                    >
                                        Apagar
                                    </Button>
                                </DialogFooter>
                            </div>
                        ) : (
                            <Button variant="outline" onClick={() => setConfirming(true)}>
                                Apagar informações acadêmicas salvas neste navegador
                            </Button>
                        )}
                    </div>
                    <p className="text-muted-foreground">
                        Sua conexão com o SIGAA pode expirar após até 8 horas. Isso não altera o
                        prazo escolhido para guardar os dados.
                    </p>
                    {message && <output className="text-muted-foreground">{message}</output>}
                </div>
            </DialogContent>
        </Dialog>
    );
}

/** Métricas opcionais de uso: separadas do prazo de armazenamento, desligadas por padrão. */
export function AnalyticsSetting() {
    const [on, setOn] = useState(() => localStorageRepository.get('analytics-consent') === true);
    return (
        <label className="flex items-start gap-3 py-2.5 text-sm">
            <input
                type="checkbox"
                aria-label="Ajudar com métricas de uso"
                checked={on}
                onChange={(event) => {
                    setOn(event.target.checked);
                    setAnalyticsConsent(event.target.checked);
                }}
                className="mt-1 size-4"
            />
            <span className="flex flex-col">
                <span>Ajudar com métricas de uso</span>
                <span className="text-xs text-muted-foreground">
                    Desligado por padrão. Nunca envia dados acadêmicos. Vale ao reabrir o app.
                </span>
            </span>
        </label>
    );
}
