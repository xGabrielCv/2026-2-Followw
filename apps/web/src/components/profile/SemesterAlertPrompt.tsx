import { useQuery } from '@tanstack/react-query';
import { Bell, Check, ChevronRight, X } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';

import type { SemesterAlertConfig } from '#/queries/app-config';
import type { Classroom } from '#/queries/classrooms';

import { semesterProgress } from '#/calendar';
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
import { cn } from '#/lib/shadcn';
import { useAppConfig } from '#/queries/app-config';
import { classroomsQueryOptions } from '#/queries/classrooms';
import { meQueryOptions } from '#/queries/me';
import { ownReviews } from '#/queries/reviews';

export interface AlertDismissedRecord {
    triggerId?: string;
    midDismissedSemester?: string;
}

const NO_DISMISSED: AlertDismissedRecord = {};
const dismissedStore = storedValue<AlertDismissedRecord>(
    STORAGE_KEYS.ALERT_DISMISSED,
    NO_DISMISSED
);

export interface AlertProfessorItem {
    siape: number;
    name: string;
    photo: string | null;
    subjectCode: string;
    subjectName: string;
    evaluated: boolean;
}

export interface AlertEvaluationResult {
    show: boolean;
    mode: 'manual' | 'mid' | null;
    title: string;
    message: string;
    professors: AlertProfessorItem[];
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

const SESSION_ROLL = Math.random();

const brasiliaToday = () =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

/** Lista única de professores das turmas atuais com status local de avaliação. */
export function collectCurrentProfessors(
    classrooms: Classroom[],
    reviews: Record<string, unknown>
): AlertProfessorItem[] {
    const bySiape = new Map<number, AlertProfessorItem>();
    for (const classroom of classrooms) {
        for (const prof of classroom.professors) {
            if (prof.siape == null) continue;
            if (bySiape.has(prof.siape)) continue;
            bySiape.set(prof.siape, {
                siape: prof.siape,
                name: prof.name,
                photo: prof.photo ?? null,
                subjectCode: classroom.subject.code,
                subjectName: classroom.subject.name,
                evaluated: Boolean(reviews[String(prof.siape)])
            });
        }
    }
    return [...bySiape.values()];
}

/** Decide se e qual alerta de semestre deve abrir para o aluno neste acesso. */
export function evaluateSemesterAlert({
    alert,
    progress,
    classrooms,
    reviews,
    dismissed,
    closedInSession,
    midRoll
}: {
    alert: SemesterAlertConfig;
    progress: { semester: string; percent: number } | undefined;
    classrooms: Classroom[];
    reviews: Record<string, unknown>;
    dismissed: AlertDismissedRecord;
    closedInSession: boolean;
    midRoll: number;
}): AlertEvaluationResult {
    const professors = collectCurrentProfessors(classrooms, reviews);
    const pendingCount = professors.filter((item) => !item.evaluated).length;

    if (closedInSession) {
        return { show: false, mode: null, title: '', message: '', professors, pendingCount };
    }

    if (alert.always_on) {
        return {
            show: true,
            mode: 'manual',
            title: alert.title,
            message: alert.message,
            professors,
            pendingCount
        };
    }

    if (!alert.enabled || professors.length === 0 || pendingCount === 0) {
        return { show: false, mode: null, title: '', message: '', professors, pendingCount };
    }

    const manualTriggered = Boolean(alert.triggered_at) || alert.trigger_id !== 'default';
    if (manualTriggered && dismissed.triggerId !== alert.trigger_id) {
        return {
            show: true,
            mode: 'manual',
            title: alert.title,
            message: alert.message,
            professors,
            pendingCount
        };
    }

    const midEligible =
        alert.mid_semester_enabled &&
        progress != null &&
        progress.percent >= 50 &&
        dismissed.midDismissedSemester !== progress.semester &&
        midRoll * 100 < alert.mid_semester_chance;

    if (midEligible) {
        return {
            show: true,
            mode: 'mid',
            title: alert.mid_semester_title,
            message: alert.mid_semester_message,
            professors,
            pendingCount
        };
    }

    return { show: false, mode: null, title: '', message: '', professors, pendingCount };
}

/** Modal de avaliação de professores e estatísticas controlado pelo admin/semestre. */
export function SemesterAlertPrompt() {
    const hydrated = useSyncExternalStore(subscribeNothing, isClient, isServer);
    const { data: user } = useQuery(meQueryOptions);
    const { alert, calendar } = useAppConfig();
    const classroomsQuery = useQuery({
        ...classroomsQueryOptions,
        enabled: Boolean(user)
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
    const [midCheckedInSession] = useState(() => readSessionValue(SESSION_MID_KEY) === '1');
    const [closedTriggerInSession, setClosedTriggerInSession] = useState(() =>
        readSessionValue(SESSION_TRIGGER_KEY)
    );
    const [reviewTarget, setReviewTarget] = useState<AlertProfessorItem | null>(null);
    const [suppressShareFallback, setSuppressShareFallback] = useState(false);

    const ready = hydrated && Boolean(user) && Boolean(alert) && !classroomsQuery.isPending;
    const today = brasiliaToday();
    const progress = ready ? semesterProgress(today, calendar) : undefined;
    const closedForSession =
        closedLocally ||
        (alert != null &&
            closedTriggerInSession ===
                (Boolean(alert.triggered_at) || alert.trigger_id !== 'default'
                    ? alert.trigger_id
                    : 'mid'));
    const evaluation =
        ready && alert
            ? evaluateSemesterAlert({
                  alert,
                  progress,
                  classrooms: classroomsQuery.data ?? [],
                  reviews,
                  dismissed,
                  closedInSession: closedForSession,
                  midRoll: midCheckedInSession ? 1 : SESSION_ROLL
              })
            : null;

    useEffect(() => {
        if (!ready || !alert?.mid_semester_enabled || midCheckedInSession) return;
        writeSessionValue(SESSION_MID_KEY, '1');
    }, [alert?.mid_semester_enabled, midCheckedInSession, ready]);

    if (!evaluation || !alert) {
        return null;
    }

    const closeSession = () => {
        const token = evaluation.mode === 'manual' ? alert.trigger_id : 'mid';
        writeSessionValue(SESSION_TRIGGER_KEY, token);
        setClosedTriggerInSession(token);
        setClosedLocally(true);
        setSuppressShareFallback(true);
    };

    const dismissPermanently = () => {
        const next: AlertDismissedRecord = { ...dismissed };
        if (evaluation.mode === 'mid' && progress) {
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

    return (
        <>
            <Dialog
                open
                onOpenChange={(open) => {
                    if (!open && !reviewTarget) closeSession();
                }}
            >
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <div className="flex items-center gap-2 text-primary">
                            <Bell className="size-4 shrink-0" aria-hidden="true" />
                            <span className="text-xs font-medium tracking-wide uppercase">
                                {evaluation.mode === 'mid'
                                    ? 'Aviso do semestre'
                                    : 'Participação na comunidade'}
                            </span>
                        </div>
                        <DialogTitle>{evaluation.title}</DialogTitle>
                        <DialogDescription>{evaluation.message}</DialogDescription>
                    </DialogHeader>

                    <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1.5">
                            <p className="text-xs font-medium text-muted-foreground">
                                Docentes das suas turmas atuais (
                                {evaluation.professors.length - evaluation.pendingCount}/
                                {evaluation.professors.length} avaliado
                                {evaluation.professors.length === 1 ? '' : 's'})
                            </p>
                            {evaluation.professors.length === 0 ? (
                                <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                                    Nenhum docente vinculado às suas turmas atuais foi encontrado.
                                </p>
                            ) : (
                                <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-1">
                                    {evaluation.professors.map((prof) => (
                                        <li key={prof.siape}>
                                            <button
                                                type="button"
                                                onClick={() => setReviewTarget(prof)}
                                                className="flex w-full items-center gap-3 rounded-lg border bg-card p-2.5 text-left transition-colors hover:bg-muted/50"
                                            >
                                                <PersonPhoto src={prof.photo} size="sm" />
                                                <div className="min-w-0 flex-1">
                                                    <p className="truncate text-sm font-medium">
                                                        {prof.name}
                                                    </p>
                                                    <p className="truncate text-xs text-muted-foreground">
                                                        {prof.subjectCode} · {prof.subjectName}
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
                                                            Avaliado
                                                        </>
                                                    ) : (
                                                        <>
                                                            <X
                                                                className="size-3"
                                                                aria-hidden="true"
                                                            />
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
                            )}
                        </div>

                        <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
                            <ShareStatisticsSetting />
                            <ShareStatisticsExplanation />
                        </div>
                    </div>

                    <DialogFooter className="sm:justify-between">
                        {!alert.always_on && (
                            <Button type="button" variant="ghost" onClick={dismissPermanently}>
                                Não mostrar novamente
                            </Button>
                        )}
                        <Button type="button" onClick={closeSession}>
                            Fechar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {reviewTarget && (
                <ReviewDialog
                    professors={[{ siape: reviewTarget.siape, name: reviewTarget.name }]}
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
