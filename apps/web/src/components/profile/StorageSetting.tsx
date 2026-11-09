import { useQueryClient } from '@tanstack/react-query';
import { HardDrive } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '#/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from '#/components/ui/dialog';
import { clearOfflineData } from '#/integrations/offline/storage';
import { setAnalyticsConsent } from '#/integrations/posthog/provider';
import { localStorageRepository } from '#/lib/local-storage';
import { localVault, retentionDays, RETENTION_DAYS } from '#/lib/local-vault';

export function StorageSetting() {
    const client = useQueryClient();
    const [days, setDays] = useState(30);
    const [usage, setUsage] = useState<number>();
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const [analytics, setAnalytics] = useState(false);
    useEffect(() => {
        void navigator.storage
            ?.estimate()
            .then(({ usage: bytes }) => setUsage(bytes))
            .catch(() => {});
    }, []);
    const save = async () => {
        setBusy(true);
        try {
            localStorageRepository.set('retention-days', days);
            setAnalyticsConsent(analytics);
            await localVault(window.localStorage).flush();
            await client.cancelQueries();
            await clearOfflineData();
            setMessage(
                'Prazo salvo. O cache de consultas foi limpo; as próximas consultas respeitarão esse prazo.'
            );
        } catch {
            setMessage('Não foi possível salvar. Os dados existentes foram preservados.');
        } finally {
            setBusy(false);
        }
    };
    return (
        <Dialog
            onOpenChange={(open) => {
                if (open) {
                    setDays(retentionDays(window.localStorage));
                    setAnalytics(localStorageRepository.get('analytics-consent') === true);
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
                        Prazo local e proteção dos dados
                    </span>
                </span>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Armazenamento neste aparelho</DialogTitle>
                    <DialogDescription>
                        Dados acadêmicos e preferências são cifrados com AES-GCM. A chave fica neste
                        navegador: isso não protege contra código malicioso executado pelo próprio
                        site ou acesso ao aparelho desbloqueado.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-3 text-sm">
                    <label htmlFor="retention-days" className="font-medium">
                        Guardar dados acadêmicos por
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
                    <p className="text-muted-foreground">
                        O prazo vale por registro, desde a gravação. Credenciais de autoria e
                        suporte permanecem até a limpeza manual para você manter acesso ao que
                        publicou. O login SIGAA vence separadamente, após até 8 horas.
                    </p>
                    <p className="text-muted-foreground">
                        Uso aproximado:{' '}
                        {usage === undefined
                            ? 'indisponível'
                            : `${(usage / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`}
                        .
                    </p>
                    <label className="flex items-start gap-2 text-muted-foreground">
                        <input
                            type="checkbox"
                            checked={analytics}
                            onChange={(event) => setAnalytics(event.target.checked)}
                            className="mt-1 size-4"
                        />
                        <span>
                            Permitir métricas opcionais de uso, sem dados acadêmicos. Desligado por
                            padrão. Análise externa, se configurada, inicia ao reabrir o app.
                        </span>
                    </label>
                    <Button disabled={busy} onClick={() => void save()}>
                        {busy ? 'Salvando…' : 'Salvar prazo e limpar cache de consultas'}
                    </Button>
                    {message && <output className="text-muted-foreground">{message}</output>}
                </div>
            </DialogContent>
        </Dialog>
    );
}
