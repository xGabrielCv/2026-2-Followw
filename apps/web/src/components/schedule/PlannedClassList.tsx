import { X } from 'lucide-react';

import type { PlannedClass } from '#/lib/planned-schedule';

import { ClassCard } from '#/components/home/ClassCard';
import { Button } from '#/components/ui/button';
import { classKey } from '#/lib/planned-schedule';
import { describeSchedule } from '#/lib/schedule';

/** As turmas da grade planejada, cada uma com o botão de tirar da grade. */
export function PlannedClassList({
    items,
    onRemove
}: {
    items: PlannedClass[];
    onRemove: (item: PlannedClass) => void;
}) {
    return (
        <ul className="flex flex-col gap-2">
            {items.map((item) => (
                <li key={classKey(item)}>
                    <ClassCard
                        compact
                        title={item.name}
                        code={item.code}
                        classNumber={item.number}
                        time={describeSchedule(item.schedule) ?? 'Horário a definir'}
                        location={item.room ?? undefined}
                        professors={item.professors.map(({ name }) => name)}
                        action={
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                aria-label={`Remover da grade: ${item.code}, turma ${item.number}`}
                                onClick={() => onRemove(item)}
                            >
                                <X aria-hidden="true" />
                            </Button>
                        }
                    />
                </li>
            ))}
        </ul>
    );
}
