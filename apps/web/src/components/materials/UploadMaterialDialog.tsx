import { useState } from 'react';

import type { MaterialKind, SubjectMaterials } from '#/queries/community';

import { MaterialsPrivacyNote } from '#/components/materials/SubjectMaterialsPanel';
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
import { Input } from '#/components/ui/input';
import { Label } from '#/components/ui/label';
import {
    ACCEPTED_FILES,
    fileProblem,
    formatBytes,
    MATERIAL_KIND_LABELS,
    MATERIAL_KINDS,
    materialSemesters
} from '#/lib/materials';
import { useOnline } from '#/lib/online';
import { titleCase } from '#/lib/profile';
import { nowInBrasilia } from '#/lib/schedule';
import { apiMessage, useUploadMaterial } from '#/queries/community';

interface UploadMaterialDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    code: string;
    data: SubjectMaterials;
    classroom?: { semester: string; number: string; professors: string[] };
}

export function UploadMaterialDialog({ open, onOpenChange, ...props }: UploadMaterialDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="viewport-dialog overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Enviar material</DialogTitle>
                    <DialogDescription>
                        Fica disponível para todos os alunos de {props.code}, de qualquer turma.
                    </DialogDescription>
                </DialogHeader>
                {open && <UploadForm {...props} onDone={() => onOpenChange(false)} />}
            </DialogContent>
        </Dialog>
    );
}

export function UploadForm({
    code,
    data,
    classroom,
    onDone
}: Omit<UploadMaterialDialogProps, 'open' | 'onOpenChange'> & { onDone: () => void }) {
    const semesters = materialSemesters(data.oldest_semester, nowInBrasilia().date);
    const [file, setFile] = useState<File | null>(null);
    const [title, setTitle] = useState('');
    const [kind, setKind] = useState<MaterialKind>('prova');
    const [semester, setSemester] = useState(
        classroom && semesters.includes(classroom.semester) ? classroom.semester : semesters[1]
    );
    const [fromClassroom, setFromClassroom] = useState(Boolean(classroom));
    const [agreed, setAgreed] = useState(false);
    const upload = useUploadMaterial(code);
    const online = useOnline();
    const problem = file && fileProblem(file, data.limits.max_file_bytes);
    const valid =
        Boolean(file) && !problem && title.trim().length >= 3 && Boolean(semester) && agreed;
    const sameClassroom = Boolean(classroom) && fromClassroom && semester === classroom?.semester;

    return (
        <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
                event.preventDefault();
                if (!valid || !file || !semester || upload.isPending) return;
                upload.mutate(
                    {
                        file,
                        title: title.trim(),
                        kind,
                        semester,
                        classroom_number: sameClassroom ? classroom?.number : null
                    },
                    { onSuccess: onDone }
                );
            }}
        >
            <MaterialsPrivacyNote />
            <p className="text-xs text-muted-foreground">
                A cota é por navegador e matéria. Trocar de navegador ou apagar as chaves pode
                reiniciá-la; o servidor não identifica o aluno para unificar essas cotas.
            </p>
            <p className="text-xs text-muted-foreground">
                Até {data.limits.max_daily_upload_attempts} autorizações de envio por matéria neste
                navegador, por dia. Tentativas canceladas ou recusadas também contam. Excluir um
                arquivo não devolve a autorização.
            </p>
            <div className="flex flex-col gap-2">
                <Label htmlFor="material-file">
                    Arquivo (PDF ou imagem, até {formatBytes(data.limits.max_file_bytes)})
                </Label>
                <Input
                    id="material-file"
                    type="file"
                    accept={ACCEPTED_FILES}
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
                {problem && <p className="text-xs text-destructive">{problem}</p>}
            </div>
            <div className="flex flex-col gap-2">
                <Label htmlFor="material-title">Título</Label>
                <Input
                    id="material-title"
                    value={title}
                    maxLength={80}
                    placeholder="Ex.: P1 de 2026.1 resolvida"
                    onChange={(event) => setTitle(event.target.value)}
                />
            </div>
            <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">Tipo</span>
                <TabFilter
                    label="Tipo do material"
                    value={kind}
                    options={MATERIAL_KINDS}
                    labels={MATERIAL_KIND_LABELS}
                    onChange={setKind}
                    className="flex-wrap"
                />
            </div>
            <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">Semestre do material</span>
                <TabFilter
                    label="Semestre do material"
                    value={semester}
                    options={semesters}
                    onChange={setSemester}
                    className="flex-wrap"
                />
            </div>
            {classroom && (
                <label className="flex items-start gap-2 text-sm">
                    <input
                        type="checkbox"
                        className="mt-0.5 size-4 accent-primary"
                        checked={fromClassroom}
                        onChange={(event) => setFromClassroom(event.target.checked)}
                    />
                    <span>
                        É da minha turma (T{classroom.number}
                        {classroom.professors.length > 0 &&
                            ` · ${classroom.professors.map(titleCase).join(', ')}`}
                        )
                        {fromClassroom && semester !== classroom.semester && (
                            <span className="block text-xs text-muted-foreground">
                                Só vale para o semestre {classroom.semester}.
                            </span>
                        )}
                    </span>
                </label>
            )}
            <label className="flex items-start gap-2 text-sm">
                <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-primary"
                    checked={agreed}
                    onChange={(event) => setAgreed(event.target.checked)}
                />
                <span>
                    O arquivo não tem meu nome, matrícula ou dados de outras pessoas, e posso
                    compartilhá-lo.
                </span>
            </label>
            <p className="text-xs text-muted-foreground">
                Limites: {data.limits.max_per_subject} arquivos por matéria, até{' '}
                {formatBytes(data.limits.max_subject_bytes)} no total. Materiais de semestres
                anteriores a {data.oldest_semester} são apagados sozinhos.
            </p>
            {upload.isError && (
                <p role="alert" className="text-xs text-destructive">
                    {apiMessage(upload.error, 'Não foi possível enviar. Tente novamente.')}
                </p>
            )}
            <DialogFooter>
                <Button type="button" variant="ghost" onClick={onDone}>
                    Cancelar
                </Button>
                <Button type="submit" disabled={!valid || upload.isPending || !online}>
                    {upload.isPending ? 'Enviando...' : 'Enviar material'}
                </Button>
            </DialogFooter>
        </form>
    );
}
