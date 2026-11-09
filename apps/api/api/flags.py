"""Partes do sistema que o administrador liga e desliga pelo painel, e os links das ferramentas."""

from typing import Literal

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.main import Database, DatabaseDep
from api.db.models import SystemFlag, SystemText

FlagKey = Literal["materials", "forum", "reviews", "groups", "tutorials", "reports"]

# Escritas da comunidade (ligadas por padrão): desligar para conter spam ou manutenção.
FLAGS: dict[str, str] = {
    "materials": "Envio de materiais",
    "forum": "Novas dúvidas, posts e respostas",
    "reviews": "Novas avaliações de docentes",
    "groups": "Edição dos grupos das turmas",
    "tutorials": "Envio de guias",
    "reports": "Denúncias e pedidos de exclusão",
    "telemetry": "Contagem de uso com consentimento",
}

# Cartões do menu Mais: (rótulo, visível por padrão).
MENU: dict[str, tuple[str, bool]] = {
    "simulador": ("Simulador de grades", True),
    "fluxo": ("Fluxo acadêmico", True),
    "estatisticas": ("Estatísticas comparadas", True),
    "grupos": ("Grupos das turmas", True),
    "avaliacoes": ("Avaliações de professores", True),
    "materiais": ("Material das matérias", True),
    "comunidade": ("Dúvidas e posts", True),
    "guias": ("Guias da UnB", True),
    "estagios": ("Estágios", True),
    "suporte": ("Suporte e ajuda", True),
    # ferramentas de matrícula extraordinária: só aparecem quando o admin liga
    "automatricula": ("Automatrícula UnB", True),
    "monitor": ("Monitor de vagas (Telegram)", True),
}

TEXTS: dict[str, tuple[str, str]] = {
    "automatricula_url": (
        "Link do Automatrícula UnB",
        "https://github.com/xGabrielCv/Auto-Matricula-SIGAA-UnB",
    ),
    "monitor_url": ("Link do bot de monitor de vagas no Telegram", ""),
}


async def flags(session: AsyncSession) -> dict[str, bool]:
    saved = dict(
        (await session.execute(select(SystemFlag.key, SystemFlag.enabled))).all()
    )
    return {key: saved.get(key, key != "telemetry") for key in FLAGS}


async def menu(session: AsyncSession) -> dict[str, bool]:
    saved = dict(
        (await session.execute(select(SystemFlag.key, SystemFlag.enabled))).all()
    )
    return {
        key: saved.get(f"menu.{key}", default) for key, (_, default) in MENU.items()
    }


async def texts(session: AsyncSession) -> dict[str, str]:
    saved = dict(
        (await session.execute(select(SystemText.key, SystemText.value))).all()
    )
    return {key: saved.get(key, default) for key, (_, default) in TEXTS.items()}


def require_enabled(key: FlagKey):
    async def check(db: DatabaseDep) -> None:
        if not (await _read(db))[key]:
            raise HTTPException(
                503, f"Desligado pela moderação por enquanto: {FLAGS[key].lower()}."
            )

    return Depends(check)


async def _read(db: Database) -> dict[str, bool]:
    return await db.read(flags)
