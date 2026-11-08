import { HardDriveDownload } from 'lucide-react';
import { useRef, useState } from 'react';

import type { Backup } from '#/lib/backup';

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
import {
    BACKUP_ERRORS,
    backupSummary,
    exportBackup,
    importBackup,
    MAX_BACKUP_BYTES,
    parseBackup
} from '#/lib/backup';
import { saveFile } from '#/lib/download';

/** Exporta e importa o que fica só neste aparelho, para trocar de celular sem usar a nuvem. */
export function BackupSetting({ registration }: { registration: string }) {
    const [open, setOpen] = useState(false);
    const [pending, setPending] = useState<Backup | null>(null);
    const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
    const input = useRef<HTMLInputElement>(null);

    const download = () => {
        const backup = exportBackup(registration);
        const day = backup.exported_at.slice(0, 10);
        saveFile(
            new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
            `followw-backup-${day}.json`
        );
        setMessage({ error: false, text: 'Backup baixado. Guarde o arquivo num lugar seguro.' });
    };

    const read = async (file: File | undefined) => {
        setPending(null);
        setMessage(null);
        if (!file) return;
        if (file.size > MAX_BACKUP_BYTES) {
            setMessage({ error: true, text: BACKUP_ERRORS['grande-demais'] });
            return;
        }
        const result = parseBackup(await file.text());
        if (typeof result === 'string') setMessage({ error: true, text: BACKUP_ERRORS[result] });
        else setPending(result);
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                setPending(null);
                setMessage(null);
            }}
        >
            <DialogTrigger
                render={
                    <Button
                        variant="ghost"
                        className="-mx-3 h-auto min-h-12 justify-start gap-3 rounded-none px-3 py-2.5"
                    />
                }
            >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info">
                    <HardDriveDownload className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 text-left">
                    <span className="block">Backup das configurações</span>
                    <span className="block truncate text-xs text-muted-foreground">
                        Exportar ou importar o que fica só neste aparelho
                    </span>
                </span>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Backup das configurações</DialogTitle>
                    <DialogDescription>
                        Configurações, calendário, marcações de presença, grades do simulador e o
                        segredo das suas avaliações ficam <strong>só neste aparelho</strong>. Para
                        levar a outro, exporte aqui e importe lá. O arquivo não passa pela nuvem do
                        Followw.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-3">
                    <Button onClick={download}>Exportar backup</Button>
                    <Button variant="outline" onClick={() => input.current?.click()}>
                        Importar de um arquivo
                    </Button>
                    <input
                        ref={input}
                        type="file"
                        accept="application/json,.json"
                        className="hidden"
                        aria-label="Arquivo de backup"
                        onChange={(event) => {
                            void read(event.target.files?.[0]);
                            event.target.value = '';
                        }}
                    />
                    {pending && (
                        <div className="rounded-xl bg-warning/10 p-3 text-sm">
                            <p className="font-medium text-warning">
                                Importar substitui o que está neste aparelho:
                            </p>
                            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                                {backupSummary(pending).map((line) => (
                                    <li key={line}>{line}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {message && (
                        <p
                            role={message.error ? 'alert' : 'status'}
                            className={
                                message.error
                                    ? 'text-sm text-destructive'
                                    : 'text-sm text-muted-foreground'
                            }
                        >
                            {message.text}
                        </p>
                    )}
                </div>
                {pending && (
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPending(null)}>
                            Cancelar
                        </Button>
                        <Button
                            onClick={() => {
                                importBackup(registration, pending);
                                setPending(null);
                                setMessage({ error: false, text: 'Backup importado.' });
                            }}
                        >
                            Importar e substituir
                        </Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
}
