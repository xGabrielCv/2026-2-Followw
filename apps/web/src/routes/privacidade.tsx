import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';

import { FollowwLogo } from '#/components/FollowwLogo';

export const Route = createFileRoute('/privacidade')({
    head: () => ({ meta: [{ title: 'Privacidade e termos | Followw' }] }),
    component: PrivacyPage
});

function PrivacyPage() {
    return (
        <main className="min-h-dvh bg-background px-6 py-10 text-foreground">
            <div className="mx-auto flex max-w-2xl flex-col gap-10">
                <header className="flex flex-col gap-6">
                    <Link
                        to="/login"
                        className="flex w-fit items-center gap-2 text-sm text-primary underline-offset-4 hover:underline"
                    >
                        <ArrowLeft className="size-4" aria-hidden="true" />
                        Voltar ao login
                    </Link>
                    <div className="flex items-center gap-3">
                        <FollowwLogo className="size-10" />
                        <h1 className="text-2xl font-bold tracking-tight">Privacidade e termos</h1>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Atualizado em <time dateTime="2026-11-08">8 de novembro de 2026</time>
                    </p>
                    <nav
                        aria-label="Nesta página"
                        className="flex flex-wrap gap-x-6 gap-y-3 text-sm"
                    >
                        <a
                            className="text-primary underline underline-offset-4"
                            href="#politica-de-privacidade"
                        >
                            Política de privacidade
                        </a>
                        <a
                            className="text-primary underline underline-offset-4"
                            href="#termos-de-servico"
                        >
                            Termos de serviço
                        </a>
                    </nav>
                </header>

                <article>
                    <section
                        aria-labelledby="politica-de-privacidade"
                        className="flex flex-col gap-4 text-sm leading-6 text-muted-foreground"
                    >
                        <h2
                            id="politica-de-privacidade"
                            className="scroll-mt-6 text-xl font-bold text-foreground"
                        >
                            Política de privacidade
                        </h2>
                        <div>
                            <h3 className="font-semibold text-foreground">Seus dados do SIGAA</h3>
                            <p>
                                Não gravamos seus dados pessoais do SIGAA no servidor. Perfil, IRA,
                                turmas, menções, frequência, colegas de turma e postagens são
                                buscados no SIGAA a cada consulta e devolvidos ao seu aparelho, sem
                                gravação no nosso banco. O seu perfil fica num cookie cifrado no seu
                                navegador.
                            </p>
                            <p className="mt-2">
                                No servidor ficam só dados públicos das turmas (horário, sala,
                                docentes e aulas previstas) e, se você liberar, os índices de
                                aprovação das suas turmas encerradas, que não dizem a sua menção.
                            </p>
                        </div>
                        <div>
                            <h3 className="font-semibold text-foreground">Comunidade</h3>
                            <p>
                                Avaliações, grupos, materiais, dúvidas, guias e denúncias não exigem
                                login para publicar, editar ou apagar, mas a leitura é pública. Não
                                associamos nome nem matrícula às publicações. Cada publicação nasce
                                com uma chave aleatória própria, gerada e guardada no seu navegador;
                                o servidor guarda só um verificador dela, sem relação com as demais
                                publicações, com a sua conta ou com o seu aparelho. Os limites
                                contra abuso usam a origem de rede só durante a janela de cada cota,
                                sem gravá-la junto ao conteúdo. Isso reduz muito, mas não elimina, a
                                possibilidade de alguém ligar publicações: o servidor ainda recebe,
                                no momento de cada pedido, dados de conexão (como o endereço de
                                rede) e o texto que você envia; publicações antigas ficam como
                                estavam até você abrir o app e migrá-las automaticamente. O conteúdo
                                fica cifrado no banco (AES-256-GCM) e os arquivos ficam cifrados e
                                sem metadados removidos na preparação do arquivo. A API e a
                                moderação conseguem decifrar esse conteúdo; não se trata de
                                criptografia de ponta a ponta. Textos, imagens e arquivos podem
                                identificar pessoas pelo próprio conteúdo: não publique dados
                                pessoais ou convites privados.
                            </p>
                        </div>
                        <div>
                            <h3 className="font-semibold text-foreground">Credenciais e sessão</h3>
                            <p>
                                Não guardamos sua senha no banco nem em logs. Ela fica apenas num
                                cookie cifrado no seu navegador, usado para autenticar no CAS/SIGAA
                                a cada pedido. Nenhuma credencial é enviada a filas persistentes ou
                                serviços externos de processamento.
                            </p>
                        </div>
                        <div>
                            <h3 className="font-semibold text-foreground">No seu dispositivo</h3>
                            <p>
                                Configurações, calendário, marcações de presença, grades e o cache
                                dos dados do SIGAA ficam cifrados no navegador por 30 dias por
                                padrão, com opções de 7, 30, 90 ou 400 dias em Uso de dados. O login
                                tem limite separado de até 8 horas. A chave local fica no próprio
                                navegador; a cifra não impede acesso por código malicioso da mesma
                                origem ou por alguém com o aparelho desbloqueado. Backups exportados
                                contêm informações pessoais em texto aberto e não incluem senhas ou
                                segredos de acesso. As chaves das suas publicações e chamados
                                permanecem cifradas até a limpeza manual para você manter acesso ao
                                que publicou.
                            </p>
                        </div>
                        <div>
                            <h3 className="font-semibold text-foreground">Análise de uso</h3>
                            <p>
                                Quando configurado pelo responsável pela instância, o PostHog recebe
                                métricas de navegação (páginas e interações), sem gravação de sessão
                                e sem os textos da tela. A API registra dados técnicos das
                                requisições, como rota, status e duração, sem matrícula, para
                                diagnóstico. A contagem de uso do painel só existe se você ligar as
                                métricas e usa uma chave aleatória nova por dia, semana e mês.
                            </p>
                        </div>
                        <div>
                            <h3 className="font-semibold text-foreground">Excluir seus dados</h3>
                            <p>
                                Não envie sua senha a ninguém. Como o servidor não guarda seus dados
                                do SIGAA, não há o que apagar deles por lá; o que você publicou na
                                comunidade pode ser apagado no próprio item, com login e a chave de
                                publicação guardada neste navegador. Qualquer pessoa pode solicitar
                                revisão ou remoção pelo botão de denúncia, inclusive sem login. Para
                                limpar o dispositivo, use Perfil, Uso de dados, ou remova os dados
                                do site no navegador.
                            </p>
                        </div>
                    </section>
                    <section
                        aria-labelledby="termos-de-servico"
                        className="flex flex-col gap-4 border-border pt-8 text-sm leading-6 text-muted-foreground"
                    >
                        <h2
                            id="termos-de-servico"
                            className="scroll-mt-6 text-xl font-bold text-foreground"
                        >
                            Termos de serviço
                        </h2>
                        <p>
                            Use o Followw com responsabilidade e respeite a privacidade das outras
                            pessoas. Integrações, scripts e automações são permitidos desde que
                            respeitem os controles de acesso e não prejudiquem o Followw ou os
                            sistemas da UnB.
                        </p>
                        <p>
                            Grupos, avaliações, materiais, conversas e guias aprovados podem ser
                            consultados sem login. Contribuir e alterar conteúdo exige autenticação
                            no SIGAA e, para editar ou apagar, a chave da publicação guardada no seu
                            navegador. Publique apenas conteúdo que você tenha direito de
                            compartilhar. Denúncias permanecem disponíveis a todos para proteger a
                            comunidade.
                        </p>
                        <p>
                            É proibido sobrecarregar o serviço, burlar restrições, acessar contas ou
                            dados sem autorização, adulterar informações de forma mal-intencionada
                            ou usar dados para perseguição (stalking), assédio, vigilância de
                            pessoas ou outras práticas abusivas. O Followw reserva o direito de
                            suspender o acesso em caso de suspeita de violação destes termos a
                            qualquer momento.
                        </p>
                        <p>
                            O Followw depende dos sistemas da UnB e pode apresentar
                            indisponibilidade ou dados desatualizados. Confira informações e
                            procedimentos acadêmicos importantes nos canais oficiais.
                        </p>
                    </section>
                </article>
            </div>
        </main>
    );
}
