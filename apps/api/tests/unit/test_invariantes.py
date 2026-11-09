"""Contrato das regras inegociáveis (docs-interno/docs/projeto/regras-inegociaveis.md)."""

import re
import subprocess
from pathlib import Path

import pytest
from fastapi.routing import APIRoute

from api.modules.admin.auth import require_admin
from api.modules.admin.router import api as admin_api

RAIZ = Path(__file__).resolve().parents[4]
PROIBIDAS_NO_PAINEL = re.compile(
    r"sql|terminal|shell|exec|console|eval|restart|reiniciar|download-file",
    re.IGNORECASE,
)


def _git(*args: str) -> str | None:
    try:
        saida = subprocess.run(
            ["git", *args], cwd=RAIZ, capture_output=True, text=True, check=True
        )
    except OSError, subprocess.CalledProcessError:
        return None
    return saida.stdout


def _chamadas(dependant) -> set:
    achadas = set()
    for filha in dependant.dependencies:
        achadas.add(filha.call)
        achadas |= _chamadas(filha)
    return achadas


def test_r_adm_01_toda_rota_do_painel_exige_administrador_autenticado():
    rotas = [r for r in admin_api.routes if isinstance(r, APIRoute)]
    assert rotas
    sem_guarda = [r.path for r in rotas if require_admin not in _chamadas(r.dependant)]
    assert sem_guarda == []


def test_r_adm_02_painel_nao_tem_terminal_sql_nem_reinicio():
    rotas = [r.path for r in admin_api.routes if isinstance(r, APIRoute)]
    assert [p for p in rotas if PROIBIDAS_NO_PAINEL.search(p)] == []


def test_r_ano_05_limite_de_materiais_e_por_turma_e_nao_por_estudante():
    from api.community_limits import CommunityLimits
    from api.modules.materials.service import MAX_PER_SUBJECT

    assert MAX_PER_SUBJECT == 50
    campo = CommunityLimits.model_fields["materials_per_subject"]
    assert campo.default == 50
    nomes = " ".join(CommunityLimits.model_fields)
    assert not re.search(r"student|aluno|author|user|per_person", nomes, re.IGNORECASE)


def test_r_git_03_commits_novos_nao_levam_coautoria_de_ia():
    mensagens = _git("log", "origin/main..HEAD", "--format=%B")
    if mensagens is None:
        pytest.skip("sem origin/main para comparar")
    assert not re.search(
        r"co-authored-by:.*(claude|anthropic|codex|openai|copilot)|generated with",
        mensagens,
        re.IGNORECASE,
    )


def test_r_git_04_nada_privado_esta_versionado():
    arquivos = _git("ls-files")
    if arquivos is None:
        pytest.skip("sem git")
    privados = [
        f
        for f in arquivos.splitlines()
        if re.match(
            r"(docs-interno/|\.local/|docs/HANDOFF|\.claude/|.*\.env$|.*\.(bak|dump|sql|gpg|pem|key)$)",
            f,
        )
        and not f.endswith(".example")
    ]
    assert privados == []


def test_r_inf_03_env_exemplo_nao_tem_segredo_real():
    exemplo = (RAIZ / ".env.example").read_text(encoding="utf-8")
    for linha in exemplo.splitlines():
        if re.match(r"\s*#", linha) or "=" not in linha:
            continue
        nome, valor = linha.split("=", 1)
        if re.search(r"PASSWORD|SECRET|KEY|TOKEN", nome, re.IGNORECASE):
            assert valor.strip() in {"", "''", '""'} or valor.strip().startswith("<"), (
                nome
            )


def test_regras_canonicas_estao_no_mkdocs_e_nos_arquivos_de_agentes():
    regras = RAIZ / "docs-interno/docs/projeto/regras-inegociaveis.md"
    if not regras.exists():
        pytest.skip("documentação privada ausente neste checkout")
    nav = (RAIZ / "docs-interno/mkdocs.yml").read_text(encoding="utf-8")
    assert "projeto/regras-inegociaveis.md" in nav
    texto = regras.read_text(encoding="utf-8")
    ids = set(re.findall(r"R-[A-Z]{3}-\d{2}", texto))
    assert len(ids) >= 40
    for agente in ("AGENTS.md", "CLAUDE.md"):
        arquivo = RAIZ / agente
        if arquivo.exists():
            assert "regras-inegociaveis" in arquivo.read_text(encoding="utf-8"), agente
