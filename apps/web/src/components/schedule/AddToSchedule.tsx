import { Plus, X } from 'lucide-react';

import type { CatalogSubject, SubjectClassroom } from '#/queries/subjects';

import { usePlannedSchedule } from '#/components/schedule/usePlannedSchedule';
import { Button } from '#/components/ui/button';
import { canAddToSchedule } from '#/lib/offer';
import { nowInBrasilia } from '#/lib/schedule';
import { cn } from '#/lib/shadcn';
import { useAppConfig } from '#/queries/app-config';

export function AddToSchedule({
    subject,
    classroom
}: {
    subject: CatalogSubject;
    classroom: SubjectClassroom;
}) {
    const { has, toggle } = usePlannedSchedule();
    const { calendar, allowCurrentSchedule } = useAppConfig();
    const item = {
        ...classroom,
        code: subject.code,
        name: subject.name,
        hours: subject.hours ?? null,
        prerequisites: subject.prerequisites ?? null,
        corequisites: subject.corequisites ?? null,
        equivalences: subject.equivalences ?? null
    };
    const selected = has(item);
    const allowed = canAddToSchedule(classroom.semester, {
        today: nowInBrasilia().date,
        allowCurrentOutsideEnrollment: allowCurrentSchedule,
        custom: calendar
    });
    const blocked = !selected && !allowed;

    return (
        <Button
            variant={selected ? 'destructive' : 'ghost'}
            size="icon"
            disabled={blocked}
            title={
                blocked
                    ? 'Adicionar turmas do semestre atual abre apenas no período de matrícula'
                    : undefined
            }
            className={cn(
                'rounded-lg',
                !selected &&
                    !blocked &&
                    'bg-primary/15 text-primary hover:bg-primary/25 hover:text-primary'
            )}
            aria-pressed={selected}
            aria-label={
                blocked
                    ? `Disponível para adicionar à grade apenas durante o período de matrícula: ${subject.code}, turma ${classroom.number}`
                    : `${selected ? 'Remover da' : 'Adicionar à'} grade: ${subject.code}, turma ${classroom.number}`
            }
            onClick={() => toggle(item)}
        >
            {selected ? <X aria-hidden="true" /> : <Plus aria-hidden="true" />}
        </Button>
    );
}
