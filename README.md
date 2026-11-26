# 📚 Followw UnB

<p align="center">

**O SIGAA e a vida na UnB num só app — rápido, offline e sem guardar seus dados pessoais.**

Agenda do dia • Turmas e frequência • Cardápio e carteirinha do RU • Fluxo e notas do PAS • Comunidade anônima • Estágios

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
> Este repositório é um **fork** do [**Followw UnB**](https://github.com/unb-mds/2026-2-Followw)
> (MDS/UnB) e também incorpora dados abertos, recursos e referências do
> [**Tamburetei UnB**](https://github.com/unb-mds/2026-02-TambureteiUnB) (como notas de corte
> históricas do PAS/Cebraspe e exportação em dados abertos), adaptados à arquitetura deste projeto:
> **zero dados pessoais do aluno no servidor**, cofre local cifrado no navegador (AES-256-GCM),
> comunidade anônima cifrada em repouso, simulador de grades e IRA/MP, estágios e painel
> administrativo com RBAC e MFA.
>
> Todo o crédito pelas bases vai às equipes originais. 💚

> [!IMPORTANT]
> O Followw é **independente** e não tem vínculo oficial com a UnB, o STI, o Cebraspe ou o SIGAA.

---

## ✨ Recursos

### 🌐 Sem entrar na conta

* 🍽️ **Cardápio do RU** por campus e refeição, com opções vegetarianas;
* 🔎 **Busca pública** de matérias, cursos e docentes (semestre atual e oferta futura), com horários, vagas e requisitos;
* 🧭 **Fluxo acadêmico** por semestre, com pré/correquisitos e **notas de corte do PAS** (6 ciclos Cebraspe, Sistema Universal e cotas);
* 🤝 **Comunidade pública**: grupos, avaliações, materiais, dúvidas/posts e guias aprovados;
* 🛟 **Suporte anônimo**: abra e acompanhe chamados sem login (chave guardada só no navegador, com código de recuperação opcional).

Publicar, responder, enviar, editar e apagar exige login do SIGAA. Denúncias continuam públicas.

### 🎓 Com a conta do SIGAA (stateless)

* 📅 **Agenda do dia**, com aula atual, próxima aula e tempo restante;
* 🏫 **Minhas turmas**: notas, postagens, downloads de anexos, **plano de ensino** e **frequência** com calendário e alerta de 25%;
* 🧪 **Simulador de grades** (otimizador em Web Worker), **simulador de IRA e MP** e **projeção de formatura / integralização**;
* 🧠 **Recomendações** de matérias pelo fluxo e **estatísticas comparadas** (calculadas no aparelho, com exportação em Dados Abertos CSV/JSON);
* 💼 **Estágios** do mural do SIGAA com filtros por curso e bolsa;
* 💳 **RU completo**: saldo, extrato, histórico/carteirinha em PDF e **carteirinha preservada offline** no cofre cifrado;
* 📴 **PWA offline**: abre instantaneamente e sincroniza em segundo plano.

### 🤝 Comunidade anônima & 🛠️ Administração

* ⭐ Avaliações de professores, 💬 grupos das turmas, 📁 materiais (varredura `YARA-X`, inspetor PDF/OLE2, ClamAV opcional e reconstrução), ❓ fórum e 📘 guias;
* 🖥️ Painel em `/api/admin` com RBAC (`moderator`, `administrator`, `owner`), MFA TOTP com step-up de 15 min, operação de pools/circuitos, sincronização agendada, moderação, suporte, aviso operacional público, auditoria imutável e gateway isolado do CloudBeaver Community para o Owner.

---

## 🔒 Privacidade em primeiro lugar

| O quê | Onde fica |
| --- | --- |
| Sessão do SIGAA (matrícula e senha) | 🔐 cookie JWE cifrado, **só no navegador** (até 8 h) |
| Perfil, IRA, turmas, notas, frequência, plano de ensino, carteirinha | 📱 **só no seu aparelho** (cofre Web Crypto AES-256-GCM / IndexedDB); o servidor busca no SIGAA e esquece |
| Configurações, calendário, presenças, grades e simulações | 📱 só no seu aparelho (retenção configurável: 7, 30, 90 ou 400 dias) |
| Avaliações, grupos, materiais, posts, guias e chamados | ☁️ PostgreSQL + arquivos cifrados na aplicação (AES-256-GCM), **sem nome nem matrícula** |
| Índices de aprovação das turmas | ☁️ só se você liberar, e apenas percentuais agregados da turma |

Cada publicação ou chamado nasce com uma **credencial aleatória de 256 bits** gerada no navegador; o servidor guarda apenas um verificador HMAC e recusa cookies acadêmicos em escritas comunitárias. A cifra local protege cópias em disco/armazenamento, mas não substitui bloqueio do aparelho nem proteção contra código malicioso na própria página. O backup manual exportado é JSON aberto sem senha, foto, bio nem chaves de autoria.

No banco, a API conecta com o papel restrito `followw_app` sob **Row-Level Security (`FORCE ROW LEVEL SECURITY`)**. Consultas públicas ao SIGAA/RU passam por cache, *single-flight*, *circuit breaker* e pool HTTP compartilhado.

---

## 🏠 Execução local (Windows)

```powershell
git clone https://github.com/xGabrielCv/2026-2-Followw.git
cd 2026-2-Followw
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run.ps1
```

O inicializador prepara PostgreSQL 18 portátil em `.local/`, gera chaves próprias em `apps/api/.env`, importa o catálogo público de referência (`bootstrap_data.py`), instala o CloudBeaver Community em loopback (opcional com `-SkipCloudBeaver`) e sobe o app em <http://localhost:3000>. Cadastre o Owner local em <http://localhost:3000/api/admin>; para recuperar fatores perdidos do Owner, execute `.\scripts\admin-password.cmd --recover PSEUDONIMO`.

```powershell
.\scripts\run.ps1 -NoBrowser       # inicia sem abrir o navegador
.\scripts\run.ps1 -Offline         # sem consultas externas após o setup inicial
.\scripts\run.ps1 -SkipDataUpdate  # não agenda atualização pública em segundo plano
.\scripts\run.ps1 -Test            # lint, tipos e testes da API e do front
.\scripts\stop.ps1                 # encerra todos os serviços
.\scripts\restart.ps1              # reinicia sem abrir outra aba
.\scripts\project-size.ps1         # mede tamanho lógico e em disco (-Clean / -Compress)
```

Na instalação local, o front consulta a API em `127.0.0.1:8000` (ou `API_PORT` / `API_INTERNAL_URL`). A pasta `deploy/` contém preparação para Docker/Caddy (ainda não validada em contêiner); produção exige HTTPS, `ENVIRONMENT=production`, `ADMIN_ALLOWED_IPS`, `RATE_LIMIT_BACKEND=postgres` e `SESSION_LOCK_BACKEND=postgres`.

---

## 🧪 Testes e estrutura

```powershell
.\scripts\run.ps1 -Test
cd apps\web; bun run e2e
cd apps\api; uv run --no-sync python loadtest/run.py --workers 4 --levels 100,250,500 --seconds 20
```

Testes automatizados e de carga usam banco sintético e simulador local com saída de rede bloqueada: **nunca** atingem o SIGAA real.

```text
apps/
├── api/              API em FastAPI (Python 3.14 + PostgreSQL + RLS)
└── web/              App web em TanStack Start (React 19 + Bun + PWA)
packages/
├── sigaa-client/     Cliente assíncrono do SIGAA
└── unb-browser/      Serviços públicos da UnB (RU e calendário)
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

**Recursos e dados abertos integrados do [unb-mds/2026-02-TambureteiUnB](https://github.com/unb-mds/2026-02-TambureteiUnB) (Tamburetei UnB):**

<table>
<tr>
<td align="center"><a href="https://github.com/bcaueLPS"><img src="https://github.com/bcaueLPS.png?size=96" width="72" height="72" alt="Avatar de bcaueLPS"><br><strong>@bcaueLPS</strong></a></td>
<td align="center"><a href="https://github.com/diangellis"><img src="https://github.com/diangellis.png?size=96" width="72" height="72" alt="Avatar de diangellis"><br><strong>@diangellis</strong></a></td>
<td align="center"><a href="https://github.com/LuisGuilherme67"><img src="https://github.com/LuisGuilherme67.png?size=96" width="72" height="72" alt="Avatar de LuisGuilherme67"><br><strong>@LuisGuilherme67</strong></a></td>
<td align="center"><a href="https://github.com/lucasssmira"><img src="https://github.com/lucasssmira.png?size=96" width="72" height="72" alt="Avatar de lucasssmira"><br><strong>@lucasssmira</strong></a></td>
</tr>
<tr>
<td align="center"><a href="https://github.com/LuizaCarvalho691"><img src="https://github.com/LuizaCarvalho691.png?size=96" width="72" height="72" alt="Avatar de LuizaCarvalho691"><br><strong>@LuizaCarvalho691</strong></a></td>
<td align="center"><a href="https://github.com/mariav-07"><img src="https://github.com/mariav-07.png?size=96" width="72" height="72" alt="Avatar de mariav-07"><br><strong>@mariav-07</strong></a></td>
<td align="center"><a href="https://github.com/thamiresellensa"><img src="https://github.com/thamiresellensa.png?size=96" width="72" height="72" alt="Avatar de thamiresellensa"><br><strong>@thamiresellensa</strong></a></td>
</tr>
</table>

**Desenvolvimento deste fork:**

<table><tr><td align="center"><a href="https://github.com/xGabrielCv"><img src="https://github.com/xGabrielCv.png?size=96" width="80" height="80" alt="Avatar de Gabriel"><br><strong>@xGabrielCv</strong></a><br>Jesus Gabriel Carvalho Ventura</td></tr></table>

Veja também o [**Automatrícula UnB (SIGAA Sniper)**](https://github.com/xGabrielCv/Auto-Matricula-SIGAA-UnB).

---

## 📄 Licença

Distribuído sob a licença MIT, preservando os créditos do [Followw UnB](https://github.com/unb-mds/2026-2-Followw) e do [Tamburetei UnB](https://github.com/unb-mds/2026-02-TambureteiUnB). Veja [LICENSE](LICENSE).
