"""Redefinição de estatísticas de USO e métricas operacionais (só o Owner, com MFA recente).

O que pode ser zerado é uma lista fechada. Conteúdo (avaliações, materiais, grupos, fóruns, chamados),
catálogo, estatísticas acadêmicas compartilhadas, contas, MFA, chaves e o log de auditoria NUNCA
são tocados por esta operação.
"""

from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api import metrics, resilience
from api.db.main import DatabaseDep
from api.db.models import ActiveUser
from api.modules.admin import auth
from api.modules.admin.permissions import Principal
from api.modules.admin.service import log

router = APIRouter(include_in_schema=False)
Owner = Annotated[Principal, auth.require_permission("owner")]
Group = Literal["usage", "requests", "origins"]

GROUPS: dict[Group, tuple[str, str]] = {
    "usage": (
        "Contadores de uso (alunos ativos por dia, semana e mês)",
        "Chaves anônimas por período. Zera os gráficos de uso; não apaga nenhuma publicação.",
    ),
    "requests": (
        "Requisições e latências deste processo",
        "Contagem por rota, erros e percentis guardados em memória.",
    ),
    "origins": (
        "Contadores de origens externas e cache",
        "Consultas ao SIGAA/UnB, pedidos atendidos sem nova consulta, circuito e cache (em memória).",
    ),
}
# Conferido por teste: nada daqui é apagado por esta operação.
PROTECTED = (
    "catálogo acadêmico",
    "avaliações, grupos, materiais, fóruns, guias",
    "chamados e mensagens",
    "estatísticas acadêmicas compartilhadas",
    "contas, cargos, MFA, sessões",
    "log de auditoria",
    "chaves e configurações",
)
CONFIRMATION = "REDEFINIR"


class Reset(BaseModel):
    groups: list[Group] = Field(min_length=1, max_length=len(GROUPS))
    confirmation: str


async def _counts(session: AsyncSession) -> dict[str, int]:
    return {
        "usage": await session.scalar(select(func.count()).select_from(ActiveUser))
        or 0,
        "requests": len(metrics.snapshot()["routes"]),
        "origins": len(resilience.counters()),
    }


class StatisticsService:
    def __init__(self, db: DatabaseDep) -> None:
        self._db = db

    async def preview(self) -> dict:
        counts = await self._db.read(_counts)
        return {
            "generated_at": datetime.now(UTC).isoformat(),
            "groups": [
                {"id": key, "label": label, "detail": detail, "items": counts[key]}
                for key, (label, detail) in GROUPS.items()
            ],
            "protected": list(PROTECTED),
            # resumo sem dado pessoal, para guardar antes de zerar
            "summary": {
                "requests": metrics.snapshot()["routes"][:50],
                "origins": resilience.counters(),
                "usage_rows": counts["usage"],
            },
        }

    async def reset(self, actor: Principal, body: Reset) -> dict[str, int]:
        if body.confirmation.strip() != CONFIRMATION:
            raise HTTPException(422, f"Digite {CONFIRMATION} para confirmar.")
        groups = sorted(set(body.groups))

        async def write(session: AsyncSession) -> dict[str, int]:
            before = await _counts(session)
            if "usage" in groups:
                await session.execute(delete(ActiveUser))
            await log(
                session,
                "admin.statistics_reset",
                "statistics",
                None,
                ", ".join(groups),
                actor=actor,
            )
            return before

        before = await self._db.write(write)
        # memória só depois do banco confirmar
        if "requests" in groups:
            metrics.reset()
        if "origins" in groups:
            resilience.reset_counters()
        return {key: before[key] for key in groups}


StatisticsServiceDep = Annotated[StatisticsService, Depends()]


@router.get("/reset-preview")
async def preview(_: Owner, service: StatisticsServiceDep) -> dict:
    return await service.preview()


@router.post("/reset")
async def reset(actor: Owner, service: StatisticsServiceDep, body: Reset) -> dict:
    return {"cleared": await service.reset(actor, body)}
