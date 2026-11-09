import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, type LinkProps } from '@tanstack/react-router';
import {
    BellRing,
    BookOpenText,
    Bot,
    BriefcaseBusiness,
    LifeBuoy,
    CalendarRange,
    ChartColumn,
    ChevronRight,
    FolderOpen,
    GitFork,
    MessagesSquare,
    Star
} from 'lucide-react';
import { useState } from 'react';

import { WhatsAppIcon } from '#/components/community/PlatformIcon';
import { HeaderBar, HeaderTitle } from '#/components/HeaderBar';
import { TOOLS, ToolDialog, type ToolInfo } from '#/components/tools/ToolDialog';
import { cn } from '#/lib/shadcn';
import { appConfigQueryOptions, menuVisible } from '#/queries/app-config';
import { meQueryOptions } from '#/queries/me';

export const Route = createFileRoute('/_app/mais')({
    head: () => ({ meta: [{ title: 'Mais | Followw' }] }),
    staticData: {
        header: () => (
            <HeaderBar>
                <HeaderTitle>Mais</HeaderTitle>
            </HeaderBar>
        )
    },
    component: MaisPage
});

function MaisPage() {
    const { data: user } = useSuspenseQuery(meQueryOptions);
    const { data: config } = useQuery(appConfigQueryOptions);
    const courseId = user?.course?.id;
    const show = (key: string) => menuVisible(config, key);
    const tools = (['automatricula', 'monitor'] as const).filter(show);

    return (
        <div className="flex flex-col gap-5 pb-8">
            <MenuGroup title="Planejamento">
                {show('simulador') && (
                    <MenuCard
                        link={{ to: '/simulador' }}
                        icon={<CalendarRange className="size-5" aria-hidden="true" />}
                        tone="bg-primary/10 text-primary"
                        title="Simulador de grades"
                        description="Monte várias grades do próximo semestre e compare."
                    />
                )}
                {show('fluxo') && (
                    <MenuCard
                        link={
                            courseId != null
                                ? { to: '/cursos/$id', params: { id: courseId } }
                                : { to: '/login' }
                        }
                        icon={<GitFork className="size-5" aria-hidden="true" />}
                        tone="bg-flow-3/15 text-flow-3"
                        title="Fluxo acadêmico"
                        description={
                            courseId != null
                                ? 'Seu fluxo, o que falta e as estatísticas do curso.'
                                : 'Entre com o SIGAA para ver o fluxo do seu curso.'
                        }
                    />
                )}
                {show('estatisticas') && (
                    <MenuCard
                        link={{ to: '/estatisticas' }}
                        icon={<ChartColumn className="size-5" aria-hidden="true" />}
                        tone="bg-flow-2/15 text-flow-2"
                        title="Estatísticas comparadas"
                        description="Você, seu curso e a UnB, comparados no seu aparelho."
                    />
                )}
            </MenuGroup>
            <MenuGroup title="Comunidade">
                {show('grupos') && (
                    <MenuCard
                        link={{ to: '/grupos' }}
                        icon={<WhatsAppIcon className="size-5" />}
                        tone="bg-success/10 text-success"
                        title="Grupos das turmas"
                        description="WhatsApp, Telegram, Teams e Aprender 3 de cada turma."
                    />
                )}
                {show('avaliacoes') && (
                    <MenuCard
                        link={{ to: '/avaliacoes' }}
                        icon={<Star className="size-5" aria-hidden="true" />}
                        tone="bg-warning/10 text-warning"
                        title="Avaliações de professores"
                        description="Notas anônimas, ranking e busca por matéria."
                    />
                )}
                {show('materiais') && (
                    <MenuCard
                        link={{ to: '/materiais' }}
                        icon={<FolderOpen className="size-5" aria-hidden="true" />}
                        tone="bg-info/10 text-info"
                        title="Material das matérias"
                        description="Provas, listas e resumos compartilhados."
                    />
                )}
                {show('comunidade') && (
                    <MenuCard
                        link={{ to: '/comunidade' }}
                        icon={<MessagesSquare className="size-5" aria-hidden="true" />}
                        tone="bg-flow-5/15 text-flow-5"
                        title="Dúvidas e posts"
                        description="Pergunte e converse com outros alunos, anonimamente."
                    />
                )}
                {show('guias') && (
                    <MenuCard
                        link={{ to: '/guias' }}
                        icon={<BookOpenText className="size-5" aria-hidden="true" />}
                        tone="bg-flow-1/15 text-flow-1"
                        title="Guias da UnB"
                        description="Estágio, matrícula, documentos e mais, pela comunidade."
                    />
                )}
                {show('estagios') && (
                    <MenuCard
                        link={{ to: '/estagios' }}
                        icon={<BriefcaseBusiness className="size-5" aria-hidden="true" />}
                        tone="bg-flow-4/15 text-flow-4"
                        title="Estágios"
                        description="Vagas do mural do SIGAA, com filtros e bolsa."
                    />
                )}
            </MenuGroup>
            {show('suporte') && (
                <MenuGroup title="Ajuda">
                    <MenuCard
                        link={{ to: '/suporte' }}
                        icon={<LifeBuoy className="size-5" aria-hidden="true" />}
                        tone="bg-info/10 text-info"
                        title="Suporte e ajuda"
                        description="Envie sugestões, relate problemas e acompanhe seus pedidos."
                    />
                </MenuGroup>
            )}
            {tools.length > 0 && (
                <MenuGroup title="Ferramentas">
                    {tools.map((key) => (
                        <ToolCard
                            key={key}
                            tool={{ ...TOOLS[key], href: config?.links[key] ?? null }}
                            icon={
                                key === 'automatricula' ? (
                                    <Bot className="size-5" aria-hidden="true" />
                                ) : (
                                    <BellRing className="size-5" aria-hidden="true" />
                                )
                            }
                            tone={
                                key === 'automatricula'
                                    ? 'bg-primary/10 text-primary'
                                    : 'bg-info/10 text-info'
                            }
                            description={
                                key === 'automatricula'
                                    ? 'Robô de matrícula extraordinária, no seu computador.'
                                    : 'Aviso de vagas na matrícula extraordinária, sem dados pessoais e login.'
                            }
                        />
                    ))}
                </MenuGroup>
            )}
        </div>
    );
}

function ToolCard({
    tool,
    icon,
    tone,
    description
}: {
    tool: ToolInfo;
    icon: React.ReactNode;
    tone: string;
    description: string;
}) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)} className={CARD_CLASS}>
                <CardBody icon={icon} tone={tone} title={tool.title} description={description} />
            </button>
            <ToolDialog tool={tool} open={open} onOpenChange={setOpen} />
        </>
    );
}

function MenuGroup({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="flex flex-col gap-2">
            <h2 className="px-1 text-sm font-semibold text-muted-foreground">{title}</h2>
            <nav aria-label={title} className="grid grid-cols-2 gap-3 desk:grid-cols-3">
                {children}
            </nav>
        </section>
    );
}

function MenuCard({
    link,
    icon,
    tone,
    title,
    description
}: {
    link: LinkProps;
    icon: React.ReactNode;
    tone: string;
    title: string;
    description: string;
}) {
    return (
        <Link {...link} className={CARD_CLASS}>
            <CardBody icon={icon} tone={tone} title={title} description={description} />
        </Link>
    );
}

const CARD_CLASS =
    'group flex flex-col gap-3 rounded-2xl bg-card p-4 text-left shadow-card ring-1 ring-foreground/8 transition-colors outline-none hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring';

function CardBody({
    icon,
    tone,
    title,
    description
}: {
    icon: React.ReactNode;
    tone: string;
    title: string;
    description: string;
}) {
    return (
        <>
            <span className="flex items-center justify-between">
                <span className={cn('flex size-10 items-center justify-center rounded-xl', tone)}>
                    {icon}
                </span>
                <ChevronRight
                    className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                    aria-hidden="true"
                />
            </span>
            <span className="flex flex-col gap-1">
                <span className="text-sm leading-tight font-semibold">{title}</span>
                <span className="text-xs text-muted-foreground">{description}</span>
            </span>
        </>
    );
}
