import { GraduationCap, Send, UsersRound } from 'lucide-react';

import type { GroupPlatform } from '#/queries/groups';

import { cn } from '#/lib/shadcn';

/** Balão com telefone, no traço dos ícones do lucide. */
export function WhatsAppIcon({ className }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn('size-4', className)}
            aria-hidden="true"
        >
            <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
            <path d="M9.2 8.6c.2-.4.6-.6 1-.5l.6.2c.3.1.5.4.5.7l-.1 1c0 .3-.2.5-.4.7l-.3.2a6 6 0 0 0 2.6 2.6l.2-.3c.2-.2.4-.4.7-.4l1-.1c.3 0 .6.2.7.5l.2.6c.1.4-.1.8-.5 1-1 .5-2.2.4-3.2-.1a8 8 0 0 1-3.3-3.3c-.5-1-.6-2.2-.1-3.2Z" />
        </svg>
    );
}

const ICONS: Record<GroupPlatform, React.FC<{ className?: string }>> = {
    whatsapp: WhatsAppIcon,
    telegram: Send,
    teams: UsersRound,
    aprender3: GraduationCap
};

const TONES: Record<GroupPlatform, string> = {
    whatsapp: 'bg-success/10 text-success',
    telegram: 'bg-info/10 text-info',
    teams: 'bg-flow-5/15 text-flow-5',
    aprender3: 'bg-primary/10 text-primary'
};

export function PlatformIcon({
    platform,
    className
}: {
    platform: GroupPlatform;
    className?: string;
}) {
    const Icon = ICONS[platform];
    return (
        <span
            className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-xl',
                TONES[platform],
                className
            )}
        >
            <Icon className="size-4" aria-hidden="true" />
        </span>
    );
}
