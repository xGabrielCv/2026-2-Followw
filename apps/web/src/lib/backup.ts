import type { SchedulePlans } from '#/lib/planned-schedule';
import type { CalendarEntry } from '#/queries/events';
import type { OwnReview } from '#/queries/reviews';
import type { UserSettings } from '#/queries/settings';

import { setAuthorSecret, validAuthor } from '#/lib/author';
import { marksStore, validMarks, type LessonMarks } from '#/lib/lesson-marks';
import { MAX_PLANS, schedulePlans } from '#/lib/planned-schedule';
import { entriesStore, MAX_ENTRIES, validEntry } from '#/queries/events';
import { ownReviews } from '#/queries/reviews';
import { settingsStore } from '#/queries/settings';

/**
 * Cópia do que fica só neste navegador (configurações, calendário, marcações de presença, grades
 * e o segredo das suas avaliações), para levar a outro aparelho sem passar pela nuvem.
 */
export interface Backup {
    app: 'followw';
    version: 1 | 2;
    exported_at: string;
    settings: UserSettings;
    events: CalendarEntry[];
    marks: LessonMarks;
    plans: SchedulePlans;
    reviews: Record<string, OwnReview>;
    // segredo do aparelho: leva a autoria anônima (apagar o que publicou) para o outro aparelho
    author?: string;
}

export const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
const CODE = /^[A-Z0-9]{1,16}$/;
const UUID = /^[0-9a-f-]{36}$/i;

export function exportBackup(registration: string, now = new Date()): Backup {
    const { displayName, completedSubjects, subjectColors, shareStatistics, sharePromptDismissed } =
        settingsStore(registration).getSnapshot();
    return {
        app: 'followw',
        version: 2,
        exported_at: now.toISOString(),
        settings: {
            displayName,
            completedSubjects,
            subjectColors,
            shareStatistics,
            sharePromptDismissed
        },
        events: entriesStore(registration)
            .getSnapshot()
            .map(({ id, date, title, kind, time, subject_code, notes, remind_days }) => ({
                id,
                date,
                title,
                kind,
                time,
                subject_code,
                notes,
                remind_days
            })),
        marks: marksStore(registration).getSnapshot(),
        plans: {
            active: schedulePlans.getSnapshot().active,
            plans: schedulePlans.getSnapshot().plans.map(({ id, name, items }) => ({
                id,
                name,
                items: items.map(
                    ({
                        code,
                        name: subjectName,
                        hours,
                        number,
                        semester,
                        schedule,
                        room,
                        sigaa_id,
                        vacancies,
                        occupied,
                        professors
                    }) => ({
                        code,
                        name: subjectName,
                        hours,
                        number,
                        semester,
                        schedule,
                        room,
                        sigaa_id,
                        vacancies,
                        occupied,
                        professors: professors.map(
                            ({ siape, name: professorName, photo, email }) => ({
                                siape,
                                name: professorName,
                                photo,
                                email
                            })
                        )
                    })
                )
            }))
        },
        reviews: {}
    };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

function validSettings(value: unknown): value is UserSettings {
    if (!isObject(value)) return false;
    const { displayName, completedSubjects, subjectColors, shareStatistics, sharePromptDismissed } =
        value;
    return (
        (displayName == null ||
            (typeof displayName === 'string' && displayName.trim().length <= 24)) &&
        (completedSubjects === undefined ||
            (Array.isArray(completedSubjects) &&
                completedSubjects.length <= 200 &&
                completedSubjects.every((code) => typeof code === 'string' && CODE.test(code)))) &&
        (subjectColors === undefined ||
            (isObject(subjectColors) &&
                Object.entries(subjectColors).every(
                    ([code, index]) =>
                        CODE.test(code) && Number.isInteger(index) && Number(index) >= 0
                ))) &&
        (shareStatistics === undefined || typeof shareStatistics === 'boolean') &&
        (sharePromptDismissed === undefined || typeof sharePromptDismissed === 'boolean')
    );
}

function validPlans(value: unknown): value is SchedulePlans {
    if (!isObject(value) || typeof value.active !== 'string' || !Array.isArray(value.plans))
        return false;
    return (
        value.plans.length >= 1 &&
        value.plans.length <= MAX_PLANS &&
        value.plans.every(
            (plan: unknown) =>
                isObject(plan) &&
                typeof plan.id === 'string' &&
                typeof plan.name === 'string' &&
                plan.name.length <= 40 &&
                Array.isArray(plan.items) &&
                plan.items.length <= 30 &&
                plan.items.every(
                    (item: unknown) =>
                        isObject(item) &&
                        typeof item.code === 'string' &&
                        typeof item.name === 'string' &&
                        typeof item.number === 'string' &&
                        typeof item.semester === 'string'
                )
        )
    );
}

function validReviews(value: unknown): value is Record<string, OwnReview> {
    return (
        isObject(value) &&
        Object.keys(value).length <= 500 &&
        Object.values(value).every(
            (review) =>
                isObject(review) &&
                typeof review.id === 'string' &&
                UUID.test(review.id) &&
                typeof review.token === 'string' &&
                review.token.length <= 128 &&
                typeof review.rating === 'number'
        )
    );
}

export type BackupError =
    | 'grande-demais'
    | 'json-invalido'
    | 'nao-e-do-followw'
    | 'versao-desconhecida'
    | 'conteudo-invalido';

export const BACKUP_ERRORS: Record<BackupError, string> = {
    'grande-demais': 'O arquivo é grande demais para ser um backup do Followw.',
    'json-invalido': 'O arquivo não é um backup válido (JSON quebrado).',
    'nao-e-do-followw': 'Esse arquivo não é um backup do Followw.',
    'versao-desconhecida': 'Backup de uma versão que este app não conhece.',
    'conteudo-invalido': 'O backup tem dados fora do formato esperado e não foi importado.'
};

/** Confere o arquivo inteiro antes de gravar qualquer coisa: ou entra tudo, ou nada. */
export function parseBackup(text: string): Backup | BackupError {
    if (text.length > MAX_BACKUP_BYTES) return 'grande-demais';
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        return 'json-invalido';
    }
    if (!isObject(data) || data.app !== 'followw') return 'nao-e-do-followw';
    if (data.version !== 1 && data.version !== 2) return 'versao-desconhecida';
    const ok =
        validSettings(data.settings) &&
        Array.isArray(data.events) &&
        data.events.length <= MAX_ENTRIES &&
        data.events.every(
            (entry: unknown) =>
                isObject(entry) &&
                typeof entry.id === 'string' &&
                // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- conferido por validEntry
                validEntry(entry as unknown as CalendarEntry)
        ) &&
        validMarks(data.marks) &&
        validPlans(data.plans) &&
        validReviews(data.reviews) &&
        (data.author === undefined || validAuthor(data.author));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- cada parte foi conferida acima
    return ok ? (data as unknown as Backup) : 'conteudo-invalido';
}

export function importBackup(registration: string, backup: Backup) {
    settingsStore(registration).set(backup.settings);
    entriesStore(registration).set(backup.events);
    marksStore(registration).set(backup.marks);
    schedulePlans.set(backup.plans);
    if (backup.version === 1) {
        ownReviews.set(backup.reviews);
        if (backup.author) setAuthorSecret(backup.author);
    }
}

export function backupSummary(backup: Backup) {
    const marks = Object.values(backup.marks).reduce(
        (total, lessons) => total + Object.keys(lessons).length,
        0
    );
    return [
        `${backup.events.length} lançamentos no calendário`,
        `${marks} marcações de presença`,
        `${backup.plans.plans.length} grades no simulador`,
        `${Object.keys(backup.reviews).length} avaliações que você pode editar`
    ];
}
