# 📚 Followw UnB

<p align="center">

**O SIGAA e a vida na UnB num só app — rápido, offline e sem guardar seus dados pessoais.**

Agenda do dia • Turmas e frequência • Cardápio do RU • Fluxo e recomendações • Comunidade anônima • Estágios

<br>

[![Python](https://img.shields.io/badge/Python-3.14-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-API-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-TanStack%20Start-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://tanstack.com/start)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-banco-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![PWA](https://img.shields.io/badge/PWA-offline-5A0FC8?style=for-the-badge&logo=pwa&logoColor=white)](#-recursos)
[![Privacidade](https://img.shields.io/badge/Dados%20pessoais-só%20no%20aparelho-2EA44F?style=for-the-badge&logo=letsencrypt&logoColor=white)](#-privacidade-em-primeiro-lugar)
[![Licença MIT](https://img.shields.io/badge/Licença-MIT-blue?style=for-the-badge)](LICENSE)

</p>

> [!NOTE]
>
> ## 🍴 Um fork com vida própria
>
> Este repositório é um **fork** do [**Followw UnB**](https://github.com/unb-mds/2026-2-Followw), projeto
> desenvolvido por estudantes na disciplina de Métodos de Desenvolvimento de Software da UnB.
>
> Ele parte do **esqueleto e da espinha dorsal** do projeto original (cliente do SIGAA, API, app web e
> catálogo público), mas traz **muitas adições e uma mudança de arquitetura**: os dados pessoais do
> aluno deixaram de ficar no servidor, a comunidade anônima ganhou cifra em repouso, e vieram
> estatísticas comparadas, estágios, simulador de grades, painel de administração e mais.
>
> Todo o crédito pela base vai para a equipe original. 💚

> [!IMPORTANT]
> O Followw é **independente** e não tem vínculo oficial com a UnB, o STI ou o SIGAA.

---

## ✨ Recursos

### 🌐 Sem entrar na conta

* 🍽️ Cardápio do RU por campus e refeição, com opções vegetarianas, para consultar e compartilhar;
* 🔎 busca de matérias, cursos e docentes, com horários, vagas, requisitos e perfis;
* 🧭 fluxo de cada curso por semestre, com carga horária, pré e correquisitos;
* 🤝 leitura de grupos, avaliações, materiais, dúvidas, posts e guias aprovados, sem conta;
* 🛟 **suporte anônimo**: abra um chamado sem login e sem se identificar (a chave fica só no seu aparelho; um
  código de recuperação opcional abre o chamado em outro).

Publicar, responder, enviar, editar e apagar exige login do SIGAA. Denúncias continuam públicas.

### 🎓 Com a conta do SIGAA

* 📅 **agenda do dia**, com a aula em andamento, a próxima e quanto falta para cada uma;
* 🏫 turmas, notas e postagens, com **frequência** e aviso quando as faltas chegam perto dos 25%;
* 🧪 **simulador de grades**: compare várias grades e deixe o app **sugerir combinações sem choque**, com dias e
  turnos bloqueados, menos janelas, menos dias no campus e explicação de cada escolha;
* 🎓 **planejar a formatura**: projeção dos semestres que faltam no fluxo obrigatório (pré e correquisitos,
  carga por semestre, "e se eu reprovar em..."). É estimativa, não confirma integralização;
* 🧠 **recomendações** de matérias pelo seu fluxo;
* 📊 **estatísticas comparadas**: você, seu curso e a UnB, calculado no seu aparelho;
* 💼 **estágios** do mural do SIGAA, com filtros por curso e bolsa;
* 💳 saldo e extrato do RU, carteirinha com QR code e histórico em PDF;
* 📴 tudo abre na hora e funciona **offline**: o app carrega o que você vai usar em segundo plano.

### 🤝 Comunidade anônima

* ⭐ avaliações de professores (nota, chamada e comentário);
* 💬 grupos das turmas (WhatsApp, Telegram, Teams, Aprender 3);
* 📁 material das matérias (provas, listas, resumos), sem metadados;
* ❓ dúvidas e posts, filtrados por campus, curso ou pelas matérias que você cursa;
* 📘 guias da UnB escritos pela comunidade e aprovados pela moderação;
* 🚩 qualquer pessoa — inclusive um docente — pode pedir a exclusão de um conteúdo.

### 🛠️ Ferramentas e administração

* 🤖 atalhos para ferramentas da matrícula extraordinária, ligados pela administração no período certo;
* 🖥️ painel do administrador: uso por dia, semana e mês, moderação, dados decifrados, funções que
  ligam e desligam, cartões do menu e recursos da instância.

---

## 🔒 Privacidade em primeiro lugar

| O quê | Onde fica |
| --- | --- |
| Sessão do SIGAA (matrícula e senha) | 🔐 cookie cifrado, **só no seu navegador** |
| Perfil, IRA, turmas, menções, frequência, colegas | 📱 **só no seu aparelho**; o servidor busca no SIGAA e esquece |
| Configurações, calendário, presenças marcadas, grades | 📱 só no seu aparelho, com backup em arquivo |
| Avaliações, grupos, materiais, posts, guias | ☁️ na nuvem, **sem nome nem matrícula** e cifrados (AES-256-GCM) |
| Índices de aprovação das turmas | ☁️ só se você liberar, e só a porcentagem da turma |
| Chamados de suporte | ☁️ texto cifrado; só um verificador da chave (nunca a chave), sem matrícula, nome ou e-mail |

A autoria anônima vem de um segredo aleatório do aparelho — nunca da matrícula — e não associamos nome ou matrícula às publicações. O conteúdo compartilhado é público e a moderação
pode decifrá-lo; não publique informações pessoais no texto ou nos arquivos. Cookies de sessão e perfil são cifrados; cache, preferências e backups locais ainda não têm
criptografia própria. O app explica tudo isso em **Perfil › Uso de dados**.

No banco, a API conecta com um papel PostgreSQL restrito (`followw_app`, sem bypass) e **Row-Level Security**
protege chamados, contas e sessões administrativas e o log de auditoria (que só aceita inserção). Cada
consulta externa a fontes públicas (SIGAA, RU) passa por cache, *single-flight* e *circuit breaker*, para
que milhares de alunos não virem milhares de consultas idênticas. Dados privados continuam indo ao SIGAA a
cada pedido: o servidor não os guarda.

---

## 🏠 Execute sua própria instância

No Windows, clone este fork e execute na raiz:

```powershell
git clone https://github.com/xGabrielCv/2026-2-Followw.git
cd 2026-2-Followw
powershell -NoProfile -ExecutionPolicy Bypass -File .\run.ps1
```

O inicializador verifica/instala Git, uv, Python 3.14, Node e Bun, prepara um PostgreSQL portátil
em `.local/`, gera chaves próprias em `apps/api/.env`, instala as dependências e sobe o app em
<http://localhost:3000>. Requer internet na primeira instalação; o winget pode pedir autorização
do Windows para instalar ferramentas. Abra <http://localhost:3000/api/admin> para cadastrar
usuário e senha do administrador local (mínimo 12 caracteres). Se já houver acesso configurado
e você o perdeu, execute `.\admin-password.cmd --reset`, reinicie e cadastre novamente.

```powershell
.\run.ps1 -NoBrowser       # inicia sem abrir o navegador
.\run.ps1 -Offline         # sem consultas externas em execução, após instalar e importar o catálogo
.\run.ps1 -SkipDataUpdate  # não agenda atualização pública em segundo plano
.\run.ps1 -Check           # confere dependências
.\run.ps1 -Test            # valida API, bibliotecas, tipos, lint e testes do front
.\run.ps1 -Update          # atualiza catálogo público no SIGAA; pode demorar
.\stop.ps1                # encerra a instância
.\restart.ps1             # reinicia sem abrir outra aba
```

O repositório contém código, testes sintéticos e os scripts de instalação, **sem banco, catálogo
coletado, materiais, credenciais ou configuração privada da sua instância**. Na primeira execução,
`bootstrap_data.py` importa o catálogo público de referência do projeto original, numa revisão
fixada com hashes SHA-256. Depois, `update_data.py` atualiza os dados públicos diretamente do SIGAA.
O calendário público faz parte do código. Uma instalação própria tem banco e comunidade próprios;
ela não recebe conteúdos ou chaves da instância de outra pessoa.

O servidor fica no próprio PC, assim como o banco e os arquivos. Login e atualizações acadêmicas
consultam os serviços oficiais da UnB; `-Offline` usa somente o que já existe localmente.
Guarde uma cópia segura das chaves, do banco e dos materiais se precisar restaurar a instância.
A documentação interna de desenvolvimento e os backups locais não são publicados.

### 🐳 Produção (preparada, ainda não testada em contêiner)

A pasta `deploy/` traz Dockerfiles (API e front), um Compose de produção (banco só em rede interna, usuários sem
privilégio, limites de recursos, HTTPS pelo Caddy), modelo de variáveis **sem segredos** e scripts de backup e
restauração. **Nada disso foi executado em Docker até agora** (só validado estaticamente): valide em um ambiente
com Docker antes de publicar uma instância, e guarde a `DATA_ENCRYPTION_KEY` fora do servidor.

Para outra plataforma, use Python 3.14+, uv, Node, Bun e PostgreSQL 18: copie `.env.example` para
`apps/api/.env`, defina chaves aleatórias próprias, rode `uv sync --all-packages --all-groups --locked`,
`uv run --no-sync python scripts/bootstrap_data.py`, `uv run --no-sync db-init` e
`uv run --no-sync api` a partir de `apps/api`. Em outro terminal: `cd apps/web; bun install --frozen-lockfile; bun dev`.
O exemplo é de desenvolvimento. Hospedagem pública precisa de HTTPS, proxy de `/api` para a API,
configuração de produção e cópias de segurança; o script local só escuta no próprio computador.

---

## 🧪 Testes e carga

```powershell
.\run.ps1 -Test                      # API, bibliotecas, tipos, lint e testes do front
cd apps\web; bun run e2e             # Playwright (admin com MFA e chamado do aluno ao atendimento)
cd apps\api; uv run --no-sync python loadtest/run.py --workers 4 --levels 100,250,500 --seconds 20
```

O teste de carga usa banco sintético e **simula** o SIGAA e a UnB com a saída de rede bloqueada: nunca é apontado
para os sistemas reais.

---

## 🧱 Estrutura

```text
apps/
├── api/              API em FastAPI (Python)
└── web/              app web em TanStack Start (React)
packages/
├── sigaa-client/     cliente assíncrono do SIGAA
└── unb-browser/      serviços públicos da UnB (calendário, RU)
```

---

## 👥 Créditos

**Projeto original — [unb-mds/2026-2-Followw](https://github.com/unb-mds/2026-2-Followw):**

<table>
<tr>
<td align="center"><a href="https://github.com/SamukaToned"><img src="https://github.com/SamukaToned.png?size=96" width="72" height="72" alt="Avatar de SamukaToned"><br><strong>@SamukaToned</strong></a></td>
<td align="center"><a href="https://github.com/eliabexp"><img src="https://github.com/eliabexp.png?size=96" width="72" height="72" alt="Avatar de eliabexp"><br><strong>@eliabexp</strong></a></td>
<td align="center"><a href="https://github.com/diegolxxz"><img src="https://github.com/diegolxxz.png?size=96" width="72" height="72" alt="Avatar de diegolxxz"><br><strong>@diegolxxz</strong></a></td>
<td align="center"><a href="https://github.com/ed9gaspar"><img src="https://github.com/ed9gaspar.png?size=96" width="72" height="72" alt="Avatar de ed9gaspar"><br><strong>@ed9gaspar</strong></a></td>
</tr>
<tr>
<td align="center"><a href="https://github.com/Mendezalv"><img src="https://github.com/Mendezalv.png?size=96" width="72" height="72" alt="Avatar de Mendezalv"><br><strong>@Mendezalv</strong></a></td>
<td align="center"><a href="https://github.com/ratatta-na-nite"><img src="https://github.com/ratatta-na-nite.png?size=96" width="72" height="72" alt="Avatar de ratatta-na-nite"><br><strong>@ratatta-na-nite</strong></a></td>
<td align="center"><a href="https://github.com/gabrielcrzojo"><img src="https://github.com/gabrielcrzojo.png?size=96" width="72" height="72" alt="Avatar de gabrielcrzojo"><br><strong>@gabrielcrzojo</strong></a></td>
<td align="center"><a href="https://github.com/RochaCarla"><img src="https://github.com/RochaCarla.png?size=96" width="72" height="72" alt="Avatar de RochaCarla"><br><strong>@RochaCarla</strong></a></td>
</tr>
</table>

**Desenvolvimento deste fork:**

<table><tr><td align="center"><a href="https://github.com/xGabrielCv"><img src="https://github.com/xGabrielCv.png?size=96" width="80" height="80" alt="Avatar de Gabriel"><br><strong>@xGabrielCv</strong></a><br>Jesus Gabriel Carvalho Ventura</td></tr></table>

Veja também o [**Automatrícula UnB (SIGAA Sniper)**](https://github.com/xGabrielCv/Auto-Matricula-SIGAA-UnB).

---

## 📄 Licença

Distribuído sob a licença MIT do projeto original. Veja [LICENSE](LICENSE).
