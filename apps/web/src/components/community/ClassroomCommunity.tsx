import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Star } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';

import type { ClassroomKey } from '#/queries/groups';

import { GroupsDialog } from '#/components/community/GroupsDialog';
import { WhatsAppIcon } from '#/components/community/PlatformIcon';
import { RatingBadge, useProfessorRatings } from '#/components/community/RatingBadge';
import { type ReviewedProfessor, ReviewDialog } from '#/components/community/ReviewDialog';
import { cn } from '#/lib/shadcn';
import { classroomGroupsQueryOptions } from '#/queries/groups';
import { meQueryOptions } from '#/queries/me';

interface ClassroomCommunityProps extends ClassroomKey {
    name: string;
    professors: { siape?: number | null; name: string }[];
    className?: string;
}

const subscribeNothing = () => () => {};
const isClient = () => true;
const isServer = () => false;

/** Os atalhos da turma: grupos de conversa e avaliar o professor, em cartões pequenos. */
export function ClassroomCommunity({
    name,
    professors,
    className,
    ...classroom
}: ClassroomCommunityProps) {
    const [dialog, setDialog] = useState<'groups' | 'review' | null>(null);
    const groups = useQuery(classroomGroupsQueryOptions(classroom));
    const { data: user } = useQuery(meQueryOptions);
    const reviewed = professors.filter(
        (professor): professor is ReviewedProfessor => professor.siape != null
    );
    const ratings = useProfessorRatings(reviewed.map(({ siape }) => siape));
    // O cache salvo no navegador não existe no servidor: só mostra depois de hidratar.
    const hydrated = useSyncExternalStore(subscribeNothing, isClient, isServer);
    const count = hydrated ? groups.data?.groups.length : undefined;
    const only = reviewed.length === 1 ? reviewed[0] : undefined;
    const rating = only && hydrated ? ratings[only.siape] : undefined;

    return (
        <div className={cn('flex flex-col gap-2', className)}>
            <ShortcutCard
                icon={<WhatsAppIcon className="size-4" />}
                tone="bg-success/10 text-success"
                title="Grupos da turma"
                detail={
                    count == null
                        ? 'Ver grupos'
                        : count === 0
                          ? 'Sem grupo'
                          : `${count} cadastrado${count > 1 ? 's' : ''}`
                }
                onClick={() => setDialog('groups')}
            />
            {user && reviewed.length > 0 && (
                <ShortcutCard
                    icon={<Star className="size-4" aria-hidden="true" />}
                    tone="bg-warning/10 text-warning"
                    title="Avaliar professor"
                    detail={rating ? <RatingBadge rating={rating} /> : 'Anônimo'}
                    onClick={() => setDialog('review')}
                />
            )}
            <GroupsDialog
                {...classroom}
                name={name}
                open={dialog === 'groups'}
                onOpenChange={(open) => setDialog(open ? 'groups' : null)}
            />
            {user && reviewed.length > 0 && (
                <ReviewDialog
                    professors={reviewed}
                    subject={classroom.code}
                    open={dialog === 'review'}
                    onOpenChange={(open) => setDialog(open ? 'review' : null)}
                />
            )}
        </div>
    );
}

function ShortcutCard({
    icon,
    tone,
    title,
    detail,
    onClick
}: {
    icon: React.ReactNode;
    tone: string;
    title: string;
    detail: React.ReactNode;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="group flex w-full items-center gap-2 rounded-2xl bg-card p-2 text-left shadow-card ring-1 ring-foreground/8 transition-colors outline-none hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring"
        >
            <span
                className={cn('flex size-8 shrink-0 items-center justify-center rounded-xl', tone)}
            >
                {icon}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-xs leading-tight font-semibold">{title}</span>
                <span className="truncate text-xs text-muted-foreground">{detail}</span>
            </span>
            <ChevronRight
                className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
            />
        </button>
    );
}
