import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
    Cloud,
    ExternalLink,
    EyeOff,
    KeyRound,
    Smartphone,
    Trash2,
    Zap,
    type LucideIcon
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { GitHubIcon, REPOSITORY_URL } from '#/components/GitHubLink';
import { BackHeader } from '#/components/HeaderBar';
import { BackupSetting } from '#/components/profile/BackupSetting';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger
} from '#/components/ui/alert-dialog';
import { Button } from '#/components/ui/button';
import { Card } from '#/components/ui/card';
import { clearOfflineData } from '#/integrations/offline/storage';
import { localStorageRepository } from '#/lib/local-storage';
import { cn } from '#/lib/shadcn';
import { meQueryOptions } from '#/queries/me';

export const Route = createFileRoute('/_app/perfil_/dados')({
    head: () => ({ meta: [{ title: 'Uso de dados | Followw' }] }),
    staticData: {
        header: () => <BackHeader to="/perfil" title="Uso de dados" />
    },
    component: DataUsagePage
});

interface Item {
    what: string;
    how: string;
}

const DEVICE: Item[] = [
    {
        what: 'Sessão do SIGAA (matrícula e senha)',
        how: 'Num cookie cifrado que o navegador guarda, mas não consegue ler. Só a API o abre, durante cada pedido, para falar com o SIGAA. Vale por até 400 dias, sem precisar entrar de novo.'
    },
    {
        what: 'Perfil: nome, foto, curso, IRA, MP, semestre de entrada e integralização',
        how: 'Também num cookie cifrado, renovado no SIGAA a cada 24 horas. O servidor não grava.'
    },
    {
        what: 'Turmas, menções, frequência, colegas, postagens, notícias, estágios e extrato do RU',
        how: 'No cache do app, neste aparelho, por até 400 dias. Esse cache não tem uma camada própria de criptografia. Ao abrir o app, ele busca primeiro a agenda e as turmas e depois o resto, em segundo plano; de novo só quando o dado envelhece.'
    },
    {
        what: 'Configurações, calendário, marcações de presença, grades do simulador e o segredo das suas avaliações',
        how: 'Só no armazenamento deste navegador, separado por matrícula. Preferências e backup não têm criptografia própria: proteja o aparelho e o arquivo. Para levar a outro aparelho, use o backup.'
    },
    {
        what: 'Segredo do aparelho (chave de autoria)',
        how: 'Um código aleatório criado aqui, sem relação com a sua matrícula. É dele que sai a chave anônima do que você publica. Vai no backup.'
    }
];

const PASSING: Item[] = [
    {
        what: 'Tudo o que vem do SIGAA',
        how: 'Ao abrir uma tela (ou no carregamento em segundo plano), a API busca no SIGAA, devolve para o seu aparelho e esquece. Nada vai para o banco: nem suas menções, nem sua frequência, nem quem são seus colegas.'
    },
    {
        what: 'Carteirinha, QR do RU, histórico em PDF e mural de estágios',
        how: 'Gerados no SIGAA na hora de cada pedido.'
    },
    {
        what: 'Seu histórico nas recomendações de matérias',
        how: 'O app manda junto da busca; o servidor calcula e descarta.'
    },
    {
        what: 'Estatísticas comparadas',
        how: 'O app baixa só médias gerais e compara com o seu histórico aqui no aparelho: nada seu é enviado para isso.'
    }
];

const CLOUD: Item[] = [
    {
        what: 'Avaliações de docentes, grupos das turmas, materiais, dúvidas e posts, guias e denúncias',
        how: 'Leitura pública, sem associar nome ou matrícula à autoria. Texto e arquivos ficam cifrados em repouso (AES-256-GCM); a API e a moderação conseguem decifrá-los. Metadados são removidos, mas o próprio conteúdo pode identificar pessoas: revise antes de publicar.'
    },
    {
        what: 'Índices de aprovação das turmas (só se você liberar)',
        how: 'Só a porcentagem de aprovados e reprovados da turma, que o SIGAA mostra a todos dela. Nunca a sua menção. É deles que saem as médias das estatísticas comparadas: com a liberação desligada, suas turmas ficam de fora.'
    },
    {
        what: 'Dados públicos das turmas',
        how: 'Horário, sala, docentes e aulas previstas. O banco sabe que alguém abriu a turma, não quem.'
    },
    {
        what: 'Contagem de uso',
        how: 'Uma chave anônima por dia, semana e mês, tirada do segredo do aparelho: dá para saber quantos aparelhos usaram, nunca quem.'
    }
];

function DataUsagePage() {
    const { data: user } = useSuspenseQuery(meQueryOptions);

    return (
        <div className="flex flex-col gap-5 pb-10">
            <Card className="gap-2 bg-primary/5 p-4 ring-primary/20">
                <h1 className="text-base font-semibold">
                    Seus dados pessoais não ficam no servidor do Followw
                </h1>
                <p className="text-sm text-muted-foreground">
                    O que identifica você fica <strong>neste aparelho</strong>. O servidor só guarda
                    o que é da comunidade, sem dizer quem escreveu, e o que é público da turma.
                </p>
                <div className="mt-1 grid grid-cols-3 gap-2 text-center text-xs">
                    <Pill
                        icon={Smartphone}
                        label="Neste aparelho"
                        tone="bg-primary/10 text-primary"
                    />
                    <Pill icon={Zap} label="Só de passagem" tone="bg-info/10 text-info" />
                    <Pill icon={Cloud} label="Nuvem, anônimo" tone="bg-warning/10 text-warning" />
                </div>
            </Card>

            <Group
                icon={Smartphone}
                tone="bg-primary/10 text-primary"
                title="Fica só neste aparelho"
                items={DEVICE}
            />
            <Group
                icon={Zap}
                tone="bg-info/10 text-info"
                title="Não fica guardado em lugar nenhum"
                items={PASSING}
            />
            <Group
                icon={Cloud}
                tone="bg-warning/10 text-warning"
                title="Vai para a nuvem, sem identificar você"
                items={CLOUD}
            />

            <section className="flex flex-col gap-2">
                <SectionTitle icon={EyeOff} tone="bg-muted text-muted-foreground">
                    Quão anônimo é
                </SectionTitle>
                <Card className="gap-2 p-4 text-sm text-muted-foreground">
                    <p>
                        Para impor limites (ex.: 10 arquivos por matéria) e deixar você apagar o que
                        publicou, o servidor guarda uma <strong>chave anônima</strong> em cada
                        conteúdo. Ela sai do <strong>segredo aleatório deste aparelho</strong>, não
                        da sua matrícula, e muda em cada matéria, conversa ou turma: duas chaves
                        nunca se ligam entre si.
                    </p>
                    <p>
                        Por isso, nem quem administra o servidor, sabendo a sua matrícula, consegue
                        descobrir o que você publicou. O preço: noutro aparelho você só apaga o que
                        publicou se levar o segredo pelo backup.
                    </p>
                    <p>
                        O que você escreve pode identificar você (um detalhe da sua turma, seu nome
                        num arquivo). Marcar o curso num post de curso pequeno também. Releia antes
                        de publicar.
                    </p>
                </Card>
            </section>

            <section className="flex flex-col gap-2">
                <SectionTitle icon={KeyRound} tone="bg-muted text-muted-foreground">
                    Seu controle
                </SectionTitle>
                <DeviceUsage />
                {user && (
                    <Card className="gap-1 px-3 py-1">
                        <BackupSetting registration={user.registration} />
                        <ClearDevice registration={user.registration} />
                    </Card>
                )}
                <p className="px-1 text-xs text-muted-foreground">
                    O que você publicou pode ser apagado no próprio item. Qualquer pessoa (inclusive
                    um docente) pode pedir a exclusão de um conteúdo pelo botão de denúncia, e a
                    moderação decide. Mais detalhes na{' '}
                    <Link to="/privacidade" className="text-primary underline underline-offset-4">
                        política de privacidade
                    </Link>
                    .
                </p>
            </section>

            <a
                href={REPOSITORY_URL}
                target="_blank"
                rel="external noopener noreferrer"
                className="flex items-center gap-3 rounded-2xl bg-card p-4 text-sm shadow-card ring-1 ring-foreground/8 hover:ring-primary/40"
            >
                <GitHubIcon className="size-5 shrink-0" />
                <span className="flex-1">
                    <span className="block font-semibold">Ver o código no GitHub</span>
                    <span className="block text-xs text-muted-foreground">
                        Código aberto: confira você mesmo o que o Followw faz com os dados.
                    </span>
                </span>
                <ExternalLink className="size-4 text-muted-foreground" aria-hidden="true" />
            </a>
        </div>
    );
}

/** Quanto o Followw ocupa neste aparelho, pelo próprio navegador. */
function DeviceUsage() {
    const [bytes, setBytes] = useState<number | null>(null);
    useEffect(() => {
        navigator.storage
            ?.estimate()
            .then((estimate) => setBytes(estimate.usage ?? null))
            .catch(() => setBytes(null));
    }, []);
    if (bytes === null) return null;
    const mb = (bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    return (
        <p className="px-1 text-xs text-muted-foreground">
            Neste aparelho, o Followw ocupa <strong>{mb} MB</strong> (cache e páginas para usar
            offline).
        </p>
    );
}

function Pill({ icon: Icon, label, tone }: { icon: LucideIcon; label: string; tone: string }) {
    return (
        <span className={cn('flex flex-col items-center gap-1 rounded-xl px-1 py-2', tone)}>
            <Icon className="size-4" aria-hidden="true" />
            <span className="leading-tight font-medium">{label}</span>
        </span>
    );
}

function SectionTitle({
    icon: Icon,
    tone,
    children
}: {
    icon: LucideIcon;
    tone: string;
    children: React.ReactNode;
}) {
    return (
        <h2 className="flex items-center gap-2 px-1 text-sm font-semibold">
            <span className={cn('flex size-6 items-center justify-center rounded-md', tone)}>
                <Icon className="size-3.5" aria-hidden="true" />
            </span>
            {children}
        </h2>
    );
}

function Group({
    icon,
    tone,
    title,
    items
}: {
    icon: LucideIcon;
    tone: string;
    title: string;
    items: Item[];
}) {
    return (
        <section className="flex flex-col gap-2">
            <SectionTitle icon={icon} tone={tone}>
                {title}
            </SectionTitle>
            <Card className="gap-0 divide-y divide-border px-4 py-1">
                {items.map((item) => (
                    <div key={item.what} className="py-3">
                        <p className="text-sm font-medium">{item.what}</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                            {item.how}
                        </p>
                    </div>
                ))}
            </Card>
        </section>
    );
}

/** Apaga deste aparelho o cache e o que é desta matrícula; a sessão continua. */
function ClearDevice({ registration }: { registration: string }) {
    const queryClient = useQueryClient();
    const [done, setDone] = useState(false);

    const clear = async () => {
        for (const key of ['settings', 'events', 'marks'])
            localStorageRepository.remove(`${key}:${registration}`);
        queryClient.removeQueries({ predicate: ({ queryKey: [, path] }) => path !== '/me' });
        await clearOfflineData();
        setDone(true);
        // as stores em memória voltam a ler o storage vazio
        window.location.reload();
    };

    return (
        <AlertDialog>
            <AlertDialogTrigger
                render={
                    <Button
                        variant="ghost"
                        className="-mx-3 h-auto min-h-12 justify-start gap-3 rounded-none px-3 py-2.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    />
                }
            >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
                    <Trash2 className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 text-left">
                    <span className="block">Apagar os dados deste aparelho</span>
                    <span className="block truncate text-xs text-muted-foreground">
                        Cache, configurações, calendário e marcações
                    </span>
                </span>
            </AlertDialogTrigger>
            <AlertDialogContent size="sm">
                <AlertDialogHeader>
                    <AlertDialogTitle>Apagar os dados deste aparelho?</AlertDialogTitle>
                    <AlertDialogDescription>
                        Some o cache das turmas e, desta matrícula, as configurações, o calendário e
                        as marcações de presença. Não dá para desfazer, e eles não existem em nenhum
                        outro lugar: exporte um backup antes, se quiser guardar. Você continua
                        logado.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                        variant="destructive"
                        disabled={done}
                        onClick={() => void clear()}
                    >
                        Apagar
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
