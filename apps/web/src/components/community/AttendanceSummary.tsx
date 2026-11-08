import type { Attendance } from '#/queries/reviews';

import { ATTENDANCE_LABELS, ATTENDANCE_OPTIONS } from '#/lib/reviews';

// a API manda as três respostas; a chave que faltar conta zero
type Counts = Partial<Record<string, number>>;

/** A resposta mais comum sobre a chamada; empate ou ninguém respondeu, nenhuma. */
export function mainAttendance(counts: Counts): Attendance | null {
    const [first, second] = ATTENDANCE_OPTIONS.map(
        (kind) => [kind, counts[kind] ?? 0] as const
    ).toSorted((a, b) => b[1] - a[1]);
    if (!first || first[1] === 0 || (second && second[1] === first[1])) return null;
    return first[0];
}

const SENTENCES: Record<Attendance, string> = {
    cobra: 'Cobra chamada',
    nao_cobra: 'Não cobra chamada',
    varia: 'Chamada varia'
};

/** "Cobra chamada" e a porcentagem de cada resposta dos alunos. */
export function AttendanceSummary({ attendance }: { attendance: Counts }) {
    const total = ATTENDANCE_OPTIONS.reduce((sum, kind) => sum + (attendance[kind] ?? 0), 0);
    if (total === 0) return null;
    const main = mainAttendance(attendance);
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">
                {main ? SENTENCES[main] : 'Chamada sem consenso'}
                <span className="font-normal text-muted-foreground">
                    {' '}
                    · segundo {total} {total === 1 ? 'aluno' : 'alunos'}
                </span>
            </span>
            <ul className="flex flex-wrap gap-1.5">
                {ATTENDANCE_OPTIONS.map((kind) => (
                    <li key={kind} className="rounded-full bg-muted px-2.5 py-1 text-xs">
                        {ATTENDANCE_LABELS[kind]}{' '}
                        <span className="font-semibold tabular-nums">
                            {Math.round(((attendance[kind] ?? 0) / total) * 100)}%
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

/** Rótulo curto da chamada para listas: "Cobra chamada"; sem consenso, nada. */
export const attendanceSentence = (counts: Counts) => {
    const main = mainAttendance(counts);
    return main ? SENTENCES[main] : null;
};
