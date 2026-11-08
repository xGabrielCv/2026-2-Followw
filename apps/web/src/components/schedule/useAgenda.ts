import { useMemo } from 'react';

import type { AgendaItem } from '#/lib/agenda';

import { usePlannedSchedule } from '#/components/schedule/usePlannedSchedule';
import { agendaFor, subjectPalette } from '#/lib/agenda';
import { plannedAgenda } from '#/lib/planned-schedule';
import { useSubjectColors } from '#/queries/settings';

/**
 * A agenda de qualquer dia, gerada das turmas do SIGAA (ou da grade planejada, antes da
 * matrícula), com as cores de cada matéria: a mesma no início e no calendário.
 */
export function useAgenda(classrooms: AgendaItem[]) {
    const { items } = usePlannedSchedule();
    const { chosen } = useSubjectColors();
    const planned = useMemo(() => plannedAgenda(items), [items]);
    const real = subjectPalette(
        classrooms.map((item) => item.subject.code),
        chosen
    );
    const draft = subjectPalette(
        planned.map((item) => item.subject.code),
        chosen
    );
    return (date: string, time?: string) => {
        const agenda = agendaFor(date, classrooms, planned, time);
        return { ...agenda, colorOf: agenda.preview ? draft : real };
    };
}
