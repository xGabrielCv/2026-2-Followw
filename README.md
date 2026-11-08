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
> desenvolvido por estudantes na disciplina de Métodos de Desenvolvimento de Software da UnB. Enquanto
> a disciplina acontece, o projeto original **não pode receber contribuições externas** — por isso este
> fork existe.
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
* 🧭 fluxo de cada curso por semestre, com carga horária, pré e correquisitos.

### 🎓 Com a conta do SIGAA

* 📅 **agenda do dia**, com a aula em andamento, a próxima e quanto falta para cada uma;
* 🏫 turmas, notas e postagens, com **frequência** e aviso quando as faltas chegam perto dos 25%;
* 🧪 **simulador de grades** para comparar várias grades do próximo semestre;
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

A autoria anônima vem de um segredo aleatório do aparelho — nunca da matrícula — então nem a
administração consegue saber o que você publicou. O app explica tudo isso em **Perfil › Uso de dados**.

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

[@SamukaToned](https://github.com/SamukaToned) ·
[@eliabexp](https://github.com/eliabexp) ·
[@diegolxxz](https://github.com/diegolxxz) ·
[@ed9gaspar](https://github.com/ed9gaspar) ·
[@Mendezalv](https://github.com/Mendezalv) ·
[@ratatta-na-nite](https://github.com/ratatta-na-nite) ·
[@gabrielcrzojo](https://github.com/gabrielcrzojo) ·
[@RochaCarla](https://github.com/RochaCarla)

**Este fork:** [@xGabrielCv](https://github.com/xGabrielCv) — Jesus Gabriel Carvalho Ventura

Veja também o [**Automatrícula UnB (SIGAA Sniper)**](https://github.com/xGabrielCv/Auto-Matricula-SIGAA-UnB).

---

## 📄 Licença

Distribuído sob a licença MIT do projeto original. Veja [LICENSE](LICENSE).
