import { useState } from 'react';

import type { MaterialItem, MaterialKind, SubjectMaterials } from '#/queries/community';

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
import { MATERIAL_KIND_LABELS, MATERIAL_KINDS, materialSemesters } from '#/lib/materials';
import { useOnline } from '#/lib/online';
import { nowInBrasilia } from '#/lib/schedule';
import { apiMessage, useUpdateMaterial } from '#/queries/community';

interface EditMaterialDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    code: string;
    item: MaterialItem;
    oldestSemester: SubjectMaterials['oldest_semester'];
}

export function EditMaterialDialog({ open, onOpenChange, ...props }: EditMaterialDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="viewport-dialog overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Editar material</DialogTitle>
                    <DialogDescription>
                        Atualize o título, tipo, semestre ou turma do seu envio em {props.code}. O
                        arquivo original é mantido.
                    </DialogDescription>
                </DialogHeader>
                {open && <EditMaterialForm {...props} onDone={() => onOpenChange(false)} />}
            </DialogContent>
        </Dialog>
    );
}

function EditMaterialForm({
    code,
    item,
    oldestSemester,
    onDone
}: Omit<EditMaterialDialogProps, 'open' | 'onOpenChange'> & { onDone: () => void }) {
    const baseSemesters = materialSemesters(oldestSemester, nowInBrasilia().date);
    const semesters = baseSemesters.includes(item.semester)
        ? baseSemesters
        : [item.semester, ...baseSemesters];
    const [title, setTitle] = useState(item.title);
    const [kind, setKind] = useState<MaterialKind>(item.kind);
    const [semester, setSemester] = useState(item.semester);
    const [classroomNumber, setClassroomNumber] = useState(item.classroom_number ?? '');
    const update = useUpdateMaterial(code);
    const online = useOnline();

    const trimmedTitle = title.trim();
    const trimmedClassroom = classroomNumber.trim();
    const validClassroom = !trimmedClassroom || /^[0-9A-Za-z]{1,4}$/.test(trimmedClassroom);
    const valid = trimmedTitle.length >= 3 && Boolean(semester) && validClassroom;

    return (
        <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
                event.preventDefault();
                if (!valid || update.isPending) return;
                update.mutate(
                    {
                        id: item.id,
                        title: trimmedTitle,
                        kind,
                        semester,
                        classroom_number: trimmedClassroom || null
                    },
                    { onSuccess: onDone }
                );
            }}
        >
            <div className="flex flex-col gap-2">
                <Label htmlFor="edit-material-title">Título</Label>
                <Input
                    id="edit-material-title"
                    value={title}
                    maxLength={80}
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
            <div className="flex flex-col gap-2">
                <Label htmlFor="edit-material-classroom">Turma (opcional)</Label>
                <Input
                    id="edit-material-classroom"
                    value={classroomNumber}
                    maxLength={4}
                    placeholder="Ex.: 01"
                    onChange={(event) => setClassroomNumber(event.target.value)}
                />
                {!validClassroom && (
                    <p className="text-xs text-destructive">
                        Use até 4 letras ou números (ex.: 01, 02, A).
                    </p>
                )}
            </div>
            {update.isError && (
                <p role="alert" className="text-xs text-destructive">
                    {apiMessage(update.error, 'Não foi possível salvar as alterações.')}
                </p>
            )}
            <DialogFooter>
                <Button type="button" variant="ghost" onClick={onDone}>
                    Cancelar
                </Button>
                <Button type="submit" disabled={!valid || update.isPending || !online}>
                    {update.isPending ? 'Salvando...' : 'Salvar alterações'}
                </Button>
            </DialogFooter>
        </form>
    );
}
