import { ShieldCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import type { Attendance, OwnReview } from '#/queries/reviews';

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
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from '#/components/ui/select';
import { Textarea } from '#/components/ui/textarea';
import { titleCase } from '#/lib/profile';
import { ATTENDANCE_LABELS, ATTENDANCE_OPTIONS, ratingLabel } from '#/lib/reviews';
import { cn } from '#/lib/shadcn';
import { apiMessage } from '#/queries/community';
import { useDeleteReview, useOwnReview, useSaveReview } from '#/queries/reviews';

export interface ReviewedProfessor {
    siape: number;
    name: string;
}

interface ReviewDialogProps {
    professors: ReviewedProfessor[];
    // matéria em que o aluno teve aula com o docente
    subject?: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/** Avaliação anônima do docente: nota de 0 a 100, se cobra chamada e um comentário. */
export function ReviewDialog({ professors, subject, open, onOpenChange }: ReviewDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Avaliar professor</DialogTitle>
                    <DialogDescription>
                        Ajude outros alunos a escolherem suas turmas.
                    </DialogDescription>
                </DialogHeader>
                {/* remonta a cada abertura para começar da avaliação salva */}
                {open && (
                    <ReviewPanel
                        professors={professors}
                        subject={subject}
                        onDone={() => onOpenChange(false)}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}

/** O aviso de anonimato, a escolha do docente e o formulário. */
export function ReviewPanel({
    professors,
    subject,
    onDone
}: {
    professors: ReviewedProfessor[];
    subject?: string;
    onDone: () => void;
}) {
    const [siape, setSiape] = useState(professors[0]?.siape);
    const professor = professors.find((item) => item.siape === siape) ?? professors[0];
    const own = useOwnReview(professor?.siape ?? 0);

    return (
        <>
            <div className="flex gap-2 rounded-xl bg-primary/10 p-3 text-xs text-foreground">
                <ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden="true" />
                <p>
                    <strong className="font-semibold">
                        Avaliação sem identificação de autoria.
                    </strong>{' '}
                    O login do SIGAA autoriza a publicação; nome e matrícula não são associados à
                    avaliação. Nota, chamada e comentário são públicos. Não escreva dados pessoais.
                </p>
            </div>
            {professors.length > 1 && (
                <div className="flex flex-col gap-2">
                    <Label htmlFor="review-professor">Docente</Label>
                    <Select
                        items={professors.map((item) => ({
                            value: String(item.siape),
                            label: titleCase(item.name)
                        }))}
                        value={String(professor?.siape)}
                        onValueChange={(value) => value && setSiape(Number(value))}
                    >
                        <SelectTrigger id="review-professor" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {professors.map((item) => (
                                <SelectItem key={item.siape} value={String(item.siape)}>
                                    {titleCase(item.name)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}
            {professor && (
                <ReviewFields
                    key={professor.siape}
                    own={own}
                    professor={professor}
                    subject={subject}
                    onDone={onDone}
                />
            )}
        </>
    );
}

function ReviewFields({
    own,
    professor,
    subject,
    onDone
}: {
    own?: OwnReview;
    professor: ReviewedProfessor;
    subject?: string;
    onDone: () => void;
}) {
    const [rating, setRating] = useState(own?.rating ?? 70);
    const [semester, setSemester] = useState(own?.semester ?? '');
    const [criteria, setCriteria] = useState(own?.criteria ?? {});
    const [attendance, setAttendance] = useState<Attendance | null>(own?.attendance ?? null);
    const [comment, setComment] = useState(own?.comment ?? '');
    const save = useSaveReview();
    const remove = useDeleteReview();
    const pending = save.isPending || remove.isPending;

    return (
        <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
                event.preventDefault();
                if (pending) return;
                save.mutate(
                    {
                        siape: professor.siape,
                        body: {
                            rating,
                            semester: semester || null,
                            criteria: Object.keys(criteria).length ? criteria : null,
                            attendance,
                            comment: comment.trim() || null,
                            subject: own?.subject ?? subject ?? null
                        }
                    },
                    { onSuccess: onDone }
                );
            }}
        >
            {own && (
                <p className="text-xs text-muted-foreground">
                    Você já avaliou {titleCase(professor.name)} neste aparelho: salvar troca a
                    avaliação anterior.
                </p>
            )}
            <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                    <Label htmlFor="review-rating">Nota{professorLabel(professor)}</Label>
                    <span className="text-sm text-muted-foreground">
                        <span className="text-2xl font-bold text-foreground tabular-nums">
                            {rating}
                        </span>
                        /100 · {ratingLabel(rating)}
                    </span>
                </div>
                <input
                    id="review-rating"
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={rating}
                    onChange={(event) => setRating(Number(event.target.value))}
                    className="h-6 w-full cursor-pointer accent-primary"
                />
            </div>
            <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">Chamada</span>
                <TabFilter<Attendance>
                    label="Cobra chamada"
                    value={attendance ?? undefined}
                    options={ATTENDANCE_OPTIONS}
                    labels={ATTENDANCE_LABELS}
                    onChange={(value) => setAttendance(value === attendance ? null : value)}
                />
            </div>
            <div className="flex flex-col gap-2">
                <Label htmlFor="review-comment">Comentário (opcional)</Label>
                <Textarea
                    id="review-comment"
                    value={comment}
                    maxLength={1000}
                    placeholder="Didática, provas, trabalhos, como é a aula..."
                    onChange={(event) => setComment(event.target.value)}
                />
                <p className="flex gap-1.5 text-xs text-warning">
                    <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                    <span>
                        Seu nome não vai junto, mas o que você escreve pode te identificar. Não cite
                        sua nota, datas, conversas ou situações que só você viveu.
                    </span>
                </p>
            </div>
            <div className="flex flex-col gap-2">
                <Label htmlFor="review-semester">Semestre da experiência (opcional)</Label>
                <Input
                    id="review-semester"
                    value={semester}
                    placeholder="2026.2"
                    pattern="20[0-9]{2}\.[12]"
                    maxLength={6}
                    onChange={(event) => setSemester(event.target.value)}
                />
            </div>
            <fieldset className="flex flex-col gap-3">
                <legend className="mb-2 text-sm font-medium">Critérios opcionais · 1 a 5</legend>
                {(
                    [
                        ['clarity', 'Clareza das explicações'],
                        ['organization', 'Organização das aulas'],
                        ['assessment', 'Clareza dos critérios de avaliação']
                    ] as const
                ).map(([key, label]) => (
                    <label key={key} className="flex items-center justify-between gap-3 text-sm">
                        {label}
                        <Input
                            type="number"
                            min={1}
                            max={5}
                            step={1}
                            className="w-20"
                            aria-label={label}
                            value={criteria[key] ?? ''}
                            onChange={(event) =>
                                setCriteria({
                                    ...criteria,
                                    [key]: event.target.value ? Number(event.target.value) : null
                                })
                            }
                        />
                    </label>
                ))}
            </fieldset>
            {(save.isError || remove.isError) && (
                <p role="alert" className="text-xs text-destructive">
                    {apiMessage(
                        save.error ?? remove.error,
                        'Não foi possível salvar. Verifique a conexão e tente novamente.'
                    )}
                </p>
            )}
            <DialogFooter>
                {own && (
                    <Button
                        type="button"
                        variant="outline"
                        className={cn('text-destructive')}
                        disabled={pending}
                        onClick={() => remove.mutate(professor.siape, { onSuccess: onDone })}
                    >
                        Apagar avaliação
                    </Button>
                )}
                <Button type="submit" disabled={pending}>
                    {save.isPending
                        ? 'Enviando...'
                        : own
                          ? 'Atualizar avaliação'
                          : 'Enviar avaliação'}
                </Button>
            </DialogFooter>
        </form>
    );
}

const professorLabel = (professor: ReviewedProfessor) => ` de ${titleCase(professor.name)}`;
