import { useQuery } from '@tanstack/react-query';
import { Bell, Check, ChevronRight, X } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import type { SemesterCalendar } from '#/calendar';
import type { SemesterAlertConfig } from '#/queries/app-config';
import type { Classroom } from '#/queries/classrooms';

import { listSemesters, semesterProgress } from '#/calendar';
import { ReviewDialog } from '#/components/community/ReviewDialog';
import { SharePrompt } from '#/components/profile/SharePrompt';
import { ShareStatisticsExplanation } from '#/components/profile/ShareStatisticsDialog';
import { ShareStatisticsSetting } from '#/components/profile/ShareStatisticsSetting';
import { Button } from '#/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '#/components/ui/dialog';
import { PersonPhoto } from '#/components/ui/person-photo';
import { STORAGE_KEYS, storedValue } from '#/lib/local-storage';
import { previousRegularSemester } from '#/lib/materials';
import { cn } from '#/lib/shadcn';
import { useAppConfig } from '#/queries/app-config';
import { allClassroomsQueryOptions, classroomsQueryOptions } from '#/queries/classrooms';
import { meQueryOptions } from '#/queries/me';
import { findOwnReview, ownReviews } from '#/queries/reviews';

export interface AlertDismissedRecord {
    triggerId?: string;
    midDismissedSemester?: string;
    lastDayDismissedSemester?: string;
    firstDayDismissedSemester?: string;
    midOpenCount?: number;
    midOpenSemester?: string;
}

const NO_DISMISSED: AlertDismissedRecord = {};
const dismissedStore = storedValue<AlertDismissedRecord>(
    STORAGE_KEYS.ALERT_DISMISSED,
    NO_DISMISSED
);

export interface AlertProfessorSubject {
    code: string;
    name: string;
    evaluated: boolean;
}

export interface AlertProfessorItem {
    siape: number;
    name: string;
    photo: string | null;
    subjects: AlertProfessorSubject[];
    evaluatedCount: number;
    pendingCount: number;
    evaluated: boolean;
}

export type AlertMode = 'manual' | 'mid' | 'last_day' | 'first_day';

export interface AlertEvaluationResult {
    show: boolean;
    mode: AlertMode | null;
    title: string;
    message: string;
    periodLabel: 'atuais' | 'do semestre anterior';
    professors: AlertProfessorItem[];
    totalSubjects: number;
    evaluatedSubjects: number;
    pendingCount: number;
}

const subscribeNothing = () => () => {};
const isClient = () => true;
const isServer = () => false;

const SESSION_MID_KEY = 'followw:semester-alert-mid-session';
const SESSION_TRIGGER_KEY = 'followw:semester-alert-trigger-session';

function readSessionValue(key: string): string | null {
    try {
        return sessionStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeSessionValue(key: string, value: string) {
    try {
        sessionStorage.setItem(key, value);
    } catch {}
}

const brasiliaToday = () =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

function currentCalendarForDate(
    today: string,
    custom?: Record<string, SemesterCalendar>
): SemesterCalendar | undefined {
    const semesters = listSemesters(custom);
    return semesters.find((item) => item.period.start <= today && today <= item.period.end);
}

/** Agrupa docentes por SIAPE reunindo todas as matérias ministradas no conjunto de turmas. */
export function collectCurrentProfessors(
    classrooms: Classroom[],
    reviews: Record<string, { subject?: string | null }>
): AlertProfessorItem[] {
    const bySiape = new Map<number, AlertProfessorItem>();
    for (const classroom of classrooms) {
        const subjectCode = classroom.subject.code;
        for (const prof of classroom.professors) {
            if (prof.siape == null) continue;
            let entry = bySiape.get(prof.siape);
            if (!entry) {
                entry = {
                    siape: prof.siape,
                    name: prof.name,
                    photo: prof.photo ?? null,
                    subjects: [],
                    evaluatedCount: 0,
                    pendingCount: 0,
                    evaluated: true
                };
                bySiape.set(prof.siape, entry);
            }
            if (!entry.subjects.some((item) => item.code === subjectCode)) {
                const evaluated = Boolean(findOwnReview(reviews, prof.siape, subjectCode));
                entry.subjects.push({
                    code: subjectCode,
                    name: classroom.subject.name,
                    evaluated
                });
                if (evaluated) entry.evaluatedCount++;
                else entry.pendingCount++;
                entry.evaluated = entry.pendingCount === 0;
            }
        }
    }
    return [...bySiape.values()];
}

function summarize(professors: AlertProfessorItem[]) {
    const totalSubjects = professors.reduce((sum, item) => sum + item.subjects.length, 0);
    const evaluatedSubjects = professors.reduce((sum, item) => sum + item.evaluatedCount, 0);
    return {
        totalSubjects,
        evaluatedSubjects,
        pendingCount: totalSubjects - evaluatedSubjects
    };
}

const emptyResult = (professors: AlertProfessorItem[]): AlertEvaluationResult => ({
    show: false,
    mode: null,
    title: '',
    message: '',
    periodLabel: 'atuais',
    professors,
    ...summarize(professors)
});

/** Decide se e qual das 4 versões do alerta deve abrir neste acesso. */
export function evaluateSemesterAlert({
    alert,
    progress,
    currentCalendar,
    today = '',
    classrooms,
    previousClassrooms = [],
    reviews,
    dismissed,
    closedInSession,
    midOpenCount = 1
}: {
    alert: SemesterAlertConfig;
    progress: { semester: string; percent: number } | undefined;
    currentCalendar?: SemesterCalendar;
    today?: string;
    classrooms: Classroom[];
    previousClassrooms?: Classroom[];
    reviews: Record<string, { subject?: string | null }>;
    dismissed: AlertDismissedRecord;
    closedInSession: boolean;
    midOpenCount?: number;
}): AlertEvaluationResult {
    const currentProfessors = collectCurrentProfessors(classrooms, reviews);
    const currentStats = summarize(currentProfessors);

    if (closedInSession) {
        return emptyResult(currentProfessors);
    }

    if (alert.always_on) {
        return {
            show: true,
            mode: 'manual',
            title: alert.title,
            message: alert.message,
            periodLabel: 'atuais',
            professors: currentProfessors,
            ...currentStats
        };
    }

    if (!alert.enabled) {
        return emptyResult(currentProfessors);
    }

    const isFirstDay = Boolean(currentCalendar && today && today === currentCalendar.classes.start);
    const isLastDay = Boolean(currentCalendar && today && today === currentCalendar.classes.end);

    // 1) Primeiro dia letivo do próximo semestre -> avalia professores do semestre anterior.
    if (
        isFirstDay &&
        currentCalendar &&
        alert.first_day_enabled &&
        dismissed.firstDayDismissedSemester !== currentCalendar.semester
    ) {
        const previousProfessors = collectCurrentProfessors(previousClassrooms, reviews);
        const previousStats = summarize(previousProfessors);
        if (previousProfessors.length > 0 && previousStats.pendingCount > 0) {
            return {
                show: true,
                mode: 'first_day',
                title: alert.first_day_title,
                message: alert.first_day_message,
                periodLabel: 'do semestre anterior',
                professors: previousProfessors,
                ...previousStats
            };
        }
    }

    // 2) Último dia letivo do semestre atual -> avalia professores do semestre atual.
    if (
        isLastDay &&
        currentCalendar &&
        alert.last_day_enabled &&
        dismissed.lastDayDismissedSemester !== currentCalendar.semester &&
        currentProfessors.length > 0 &&
        currentStats.pendingCount > 0
    ) {
        return {
            show: true,
            mode: 'last_day',
            title: alert.last_day_title,
            message: alert.last_day_message,
            periodLabel: 'atuais',
            professors: currentProfessors,
            ...currentStats
        };
    }

    // 3) Disparo manual pelo admin.
    const manualTriggered = Boolean(alert.triggered_at) || alert.trigger_id !== 'default';
    if (
        manualTriggered &&
        dismissed.triggerId !== alert.trigger_id &&
        currentProfessors.length > 0 &&
        currentStats.pendingCount > 0
    ) {
        return {
            show: true,
            mode: 'manual',
            title: alert.title,
            message: alert.message,
            periodLabel: 'atuais',
            professors: currentProfessors,
            ...currentStats
        };
    }

    // 4) Metade do semestre (>= 50%) com cadência determinística a cada N aberturas.
    const step = Math.max(1, alert.mid_semester_every_n || 3);
    const matchesCadence = (Math.max(1, midOpenCount) - 1) % step === 0;
    const midEligible =
        alert.mid_semester_enabled &&
        progress != null &&
        progress.percent >= 50 &&
        !isLastDay &&
        !isFirstDay &&
        dismissed.midDismissedSemester !== progress.semester &&
        matchesCadence &&
        currentProfessors.length > 0 &&
        currentStats.pendingCount > 0;

    if (midEligible) {
        return {
            show: true,
            mode: 'mid',
            title: alert.mid_semester_title,
            message: alert.mid_semester_message,
            periodLabel: 'atuais',
            professors: currentProfessors,
            ...currentStats
        };
    }

    return emptyResult(currentProfessors);
}

const MODE_BADGES: Record<AlertMode, string> = {
    manual: 'Participação na comunidade',
    mid: 'Metade do semestre',
    last_day: 'Último dia do semestre',
    first_day: 'Semestre anterior'
};

/** Modal de avaliação de professores e estatísticas controlado pelo admin/semestre. */
export function SemesterAlertPrompt() {
    const hydrated = useSyncExternalStore(subscribeNothing, isClient, isServer);
    const { data: user } = useQuery(meQueryOptions);
    const { alert, calendar } = useAppConfig();
    const today = brasiliaToday();
    const currentCalendar = hydrated ? currentCalendarForDate(today, calendar) : undefined;
    const isFirstDay = Boolean(currentCalendar && today === currentCalendar.classes.start);

    const classroomsQuery = useQuery({
        ...classroomsQueryOptions,
        enabled: Boolean(user)
    });
    const allClassroomsQuery = useQuery({
        ...allClassroomsQueryOptions,
        enabled: Boolean(user) && isFirstDay
    });
    const reviews = useSyncExternalStore(
        ownReviews.subscribe,
        ownReviews.getSnapshot,
        ownReviews.getServerSnapshot
    );
    const dismissed = useSyncExternalStore(
        dismissedStore.subscribe,
        dismissedStore.getSnapshot,
        dismissedStore.getServerSnapshot
    );

    const [closedLocally, setClosedLocally] = useState(false);
    const bumpedRef = useRef(false);
    const [midOpenCountForSession, setMidOpenCountForSession] = useState<number>(() => {
        const stored = readSessionValue(SESSION_MID_KEY);
        const parsed = stored ? Number(stored) : NaN;
        return Number.isFinite(parsed) && parsed >= 1 ? parsed : 0;
    });
    const [closedTriggerInSession, setClosedTriggerInSession] = useState(() =>
        readSessionValue(SESSION_TRIGGER_KEY)
    );
    const [subjectPickerProf, setSubjectPickerProf] = useState<AlertProfessorItem | null>(null);
    const [reviewTarget, setReviewTarget] = useState<{
        professor: AlertProfessorItem;
        subjectCode: string;
    } | null>(null);
    const [suppressShareFallback, setSuppressShareFallback] = useState(false);

    const ready =
        hydrated &&
        Boolean(user) &&
        Boolean(alert) &&
        !classroomsQuery.isPending &&
        (!isFirstDay || !allClassroomsQuery.isPending);
    const progress = ready ? semesterProgress(today, calendar) : undefined;
    const currentSemesterName = currentCalendar?.semester ?? progress?.semester ?? '';
    const previousSemesterName = currentSemesterName
        ? previousRegularSemester(currentSemesterName)
        : '';
    const previousClassrooms =
        isFirstDay && previousSemesterName
            ? (allClassroomsQuery.data ?? []).filter((c) => c.semester === previousSemesterName)
            : [];

    // Avança a cadência determinística no máximo 1x por sessão do navegador ao atingir 50%+.
    useEffect(() => {
        if (!ready || !alert?.mid_semester_enabled || !progress || progress.percent < 50) return;
        if (bumpedRef.current || midOpenCountForSession >= 1) return;
        bumpedRef.current = true;
        const currentCount =
            dismissed.midOpenSemester === progress.semester ? (dismissed.midOpenCount ?? 0) : 0;
        const nextCount = currentCount + 1;
        dismissedStore.set({
            ...dismissed,
            midOpenSemester: progress.semester,
            midOpenCount: nextCount
        });
        writeSessionValue(SESSION_MID_KEY, String(nextCount));
        setMidOpenCountForSession(nextCount);
    }, [alert?.mid_semester_enabled, dismissed, midOpenCountForSession, progress, ready]);

    const manualTriggered = Boolean(
        alert && (Boolean(alert.triggered_at) || alert.trigger_id !== 'default')
    );
    const sessionToken = isFirstDay
        ? `first:${currentSemesterName}`
        : currentCalendar && today === currentCalendar.classes.end
          ? `last:${currentSemesterName}`
          : manualTriggered && alert
            ? alert.trigger_id
            : 'mid';

    const evaluation =
        ready && alert
            ? evaluateSemesterAlert({
                  alert,
                  progress,
                  currentCalendar,
                  today,
                  classrooms: classroomsQuery.data ?? [],
                  previousClassrooms,
                  reviews,
                  dismissed,
                  closedInSession: closedLocally || closedTriggerInSession === sessionToken,
                  midOpenCount: midOpenCountForSession || 1
              })
            : null;

    if (!evaluation || !alert) {
        return null;
    }

    const closeSession = () => {
        writeSessionValue(SESSION_TRIGGER_KEY, sessionToken);
        setClosedTriggerInSession(sessionToken);
        setClosedLocally(true);
        setSuppressShareFallback(true);
    };

    const dismissPermanently = () => {
        const next: AlertDismissedRecord = { ...dismissed };
        if (evaluation.mode === 'first_day' && currentSemesterName) {
            next.firstDayDismissedSemester = currentSemesterName;
        } else if (evaluation.mode === 'last_day' && currentSemesterName) {
            next.lastDayDismissedSemester = currentSemesterName;
        } else if (evaluation.mode === 'mid' && progress) {
            next.midDismissedSemester = progress.semester;
        } else {
            next.triggerId = alert.trigger_id;
        }
        dismissedStore.set(next);
        closeSession();
    };

    if (!evaluation.show) {
        return suppressShareFallback || Boolean(closedTriggerInSession) ? null : <SharePrompt />;
    }

    const openProfessor = (prof: AlertProfessorItem) => {
        if (prof.subjects.length === 1 && prof.subjects[0]) {
            setReviewTarget({ professor: prof, subjectCode: prof.subjects[0].code });
            return;
        }
        setSubjectPickerProf(prof);
    };

    const activePickerProf =
        subjectPickerProf &&
        (evaluation.professors.find((item) => item.siape === subjectPickerProf.siape) ??
            subjectPickerProf);

    return (
        <>
            <Dialog
                open
                onOpenChange={(open) => {
                    if (!open && !reviewTarget && !activePickerProf) closeSession();
                }}
            >
                <DialogContent className="viewport-dialog flex w-[calc(100vw-2rem)] max-w-[32rem] min-w-0 flex-col overflow-x-hidden overflow-y-auto desk:max-w-lg forced-mobile:max-w-[min(calc(100vw-2rem),26rem)]">
                    <DialogHeader className="min-w-0 pr-7">
                        <div className="flex min-w-0 items-center gap-2 text-primary">
                            <Bell className="size-4 shrink-0" aria-hidden="true" />
                            <span className="truncate text-xs font-medium tracking-wide uppercase">
                                {evaluation.mode
                                    ? MODE_BADGES[evaluation.mode]
                                    : MODE_BADGES.manual}
                            </span>
                        </div>
                        <DialogTitle className="break-words">{evaluation.title}</DialogTitle>
                        <DialogDescription className="break-words">
                            {evaluation.message}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex min-w-0 flex-col gap-3">
                        <div className="flex min-w-0 flex-col gap-1.5">
                            <p className="text-xs font-medium text-muted-foreground">
                                Docentes das suas turmas {evaluation.periodLabel} (
                                {evaluation.evaluatedSubjects}/{evaluation.totalSubjects} avaliada
                                {evaluation.totalSubjects === 1 ? '' : 's'})
                            </p>
                            {evaluation.professors.length === 0 ? (
                                <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                                    Nenhum docente vinculado às suas turmas foi encontrado.
                                </p>
                            ) : (
                                <ul className="flex max-h-56 min-w-0 flex-col gap-1.5 overflow-y-auto pr-0.5">
                                    {evaluation.professors.map((prof) => {
                                        const multiSubject = prof.subjects.length > 1;
                                        const subjectSummary = prof.subjects
                                            .map((s) => `${s.code} · ${s.name}`)
                                            .join(' • ');
                                        return (
                                            <li key={prof.siape} className="min-w-0">
                                                <button
                                                    type="button"
                                                    onClick={() => openProfessor(prof)}
                                                    className="flex w-full min-w-0 items-center gap-2.5 rounded-lg border bg-card p-2.5 text-left transition-colors hover:bg-muted/50"
                                                >
                                                    <PersonPhoto src={prof.photo} size="sm" />
                                                    <div className="min-w-0 flex-1">
                                                        <p className="truncate text-sm font-medium">
                                                            {prof.name}
                                                        </p>
                                                        <p className="line-clamp-2 text-xs text-muted-foreground">
                                                            {subjectSummary}
                                                        </p>
                                                    </div>
                                                    <span
                                                        className={cn(
                                                            'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                                                            prof.evaluated
                                                                ? 'bg-success/10 text-success'
                                                                : 'bg-destructive/10 text-destructive'
                                                        )}
                                                    >
                                                        {prof.evaluated ? (
                                                            <>
                                                                <Check
                                                                    className="size-3"
                                                                    aria-hidden="true"
                                                                />
                                                                {multiSubject
                                                                    ? `${prof.evaluatedCount}/${prof.subjects.length}`
                                                                    : 'Avaliado'}
                                                            </>
                                                        ) : (
                                                            <>
                                                                <X
                                                                    className="size-3"
                                                                    aria-hidden="true"
                                                                />
                                                                {multiSubject
                                                                    ? `Pendente (${prof.evaluatedCount}/${prof.subjects.length})`
                                                                    : 'Pendente'}
                                                            </>
                                                        )}
                                                    </span>
                                                    <ChevronRight
                                                        className="size-4 shrink-0 text-muted-foreground"
                                                        aria-hidden="true"
                                                    />
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>

                        <div className="min-w-0 rounded-lg border bg-muted/30 p-3">
                            <ShareStatisticsSetting />
                            <ShareStatisticsExplanation />
                        </div>
                    </div>

                    <DialogFooter className="flex-row flex-wrap items-center justify-end gap-2 sm:justify-between">
                        {!alert.always_on && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={dismissPermanently}
                            >
                                Não mostrar novamente
                            </Button>
                        )}
                        <Button type="button" onClick={closeSession}>
                            Fechar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {activePickerProf && (
                <Dialog
                    open
                    onOpenChange={(open) => {
                        if (!open) setSubjectPickerProf(null);
                    }}
                >
                    <DialogContent className="viewport-dialog flex w-[calc(100vw-2rem)] max-w-[30rem] min-w-0 flex-col overflow-x-hidden overflow-y-auto desk:max-w-md forced-mobile:max-w-[min(calc(100vw-2rem),26rem)]">
                        <DialogHeader className="min-w-0 pr-7">
                            <DialogTitle className="break-words">
                                Escolha a matéria para avaliar
                            </DialogTitle>
                            <DialogDescription className="break-words">
                                {activePickerProf.name} ministra {activePickerProf.subjects.length}{' '}
                                matérias com você. Selecione qual deseja avaliar:
                            </DialogDescription>
                        </DialogHeader>
                        <ul className="flex min-w-0 flex-col gap-2">
                            {activePickerProf.subjects.map((sub) => (
                                <li key={sub.code} className="min-w-0">
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setReviewTarget({
                                                professor: activePickerProf,
                                                subjectCode: sub.code
                                            })
                                        }
                                        className="flex w-full min-w-0 items-center gap-2.5 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-semibold">{sub.code}</p>
                                            <p className="truncate text-xs text-muted-foreground">
                                                {sub.name}
                                            </p>
                                        </div>
                                        <span
                                            className={cn(
                                                'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                                                sub.evaluated
                                                    ? 'bg-success/10 text-success'
                                                    : 'bg-destructive/10 text-destructive'
                                            )}
                                        >
                                            {sub.evaluated ? (
                                                <>
                                                    <Check className="size-3" aria-hidden="true" />
                                                    Avaliado
                                                </>
                                            ) : (
                                                <>
                                                    <X className="size-3" aria-hidden="true" />
                                                    Pendente
                                                </>
                                            )}
                                        </span>
                                        <ChevronRight
                                            className="size-4 shrink-0 text-muted-foreground"
                                            aria-hidden="true"
                                        />
                                    </button>
                                </li>
                            ))}
                        </ul>
                        <DialogFooter>
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={() => setSubjectPickerProf(null)}
                            >
                                Voltar
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}

            {reviewTarget && (
                <ReviewDialog
                    professors={[
                        { siape: reviewTarget.professor.siape, name: reviewTarget.professor.name }
                    ]}
                    subject={reviewTarget.subjectCode}
                    open
                    onOpenChange={(open) => {
                        if (!open) setReviewTarget(null);
                    }}
                />
            )}
        </>
    );
}
