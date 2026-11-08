"""Denúncias e pedidos de exclusão: qualquer pessoa pede, só a moderação decide."""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import Depends, HTTPException
from pydantic import BaseModel, StringConstraints
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.main import DatabaseDep
from api.db.models import (
    ClassroomGroup,
    ForumPost,
    ForumReply,
    Material,
    ProfessorReview,
    Report,
    Tutorial,
)
from api.modules.materials.service import delete_material

TargetType = Literal["review", "group", "material", "post", "reply", "tutorial"]
Reason = Literal[
    "ofensivo", "dados_pessoais", "spam", "falso", "direitos_autorais", "outro"
]

TARGETS: dict[str, type] = {
    "review": ProfessorReview,
    "group": ClassroomGroup,
    "material": Material,
    "post": ForumPost,
    "reply": ForumReply,
    "tutorial": Tutorial,
}
# Pedidos abertos para o mesmo conteúdo: além disso, o pedido repetido só conta como um.
_MAX_OPEN_PER_TARGET = 20


class ReportInput(BaseModel):
    target_type: TargetType
    target_id: uuid.UUID
    reason: Reason
    message: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None
    ) = None


class ReportCreated(BaseModel):
    id: uuid.UUID


async def delete_target(
    session: AsyncSession, target_type: str, target_id: uuid.UUID
) -> bool:
    """Apaga o conteúdo denunciado (e o arquivo, se for material)."""
    if target_type == "material":
        return await delete_material(session, target_id)
    model = TARGETS[target_type]
    result = await session.execute(delete(model).where(model.id == target_id))
    if target_type == "reply" and result.rowcount:
        await _recount_replies(session)
    return bool(result.rowcount)


async def _recount_replies(session: AsyncSession) -> None:
    replies = (
        select(func.count(ForumReply.id))
        .where(ForumReply.post_id == ForumPost.id)
        .scalar_subquery()
    )
    await session.execute(update(ForumPost).values(reply_count=replies))


class ReportService:
    def __init__(self, db: DatabaseDep) -> None:
        self._db = db

    async def create(self, body: ReportInput) -> ReportCreated:
        async def write(session: AsyncSession) -> ReportCreated:
            if await session.get(TARGETS[body.target_type], body.target_id) is None:
                raise HTTPException(404, "Conteúdo não encontrado.")
            open_reports = await session.scalar(
                select(func.count(Report.id)).where(
                    Report.target_id == body.target_id, Report.status == "pending"
                )
            )
            if (open_reports or 0) >= _MAX_OPEN_PER_TARGET:
                existing = await session.scalar(
                    select(Report.id).where(
                        Report.target_id == body.target_id, Report.status == "pending"
                    )
                )
                return ReportCreated(id=existing)
            report = Report(
                target_type=body.target_type,
                target_id=body.target_id,
                reason=body.reason,
                message=body.message or None,
            )
            session.add(report)
            await session.flush()
            return ReportCreated(id=report.id)

        return await self._db.write(write)


async def resolve(session: AsyncSession, report_id: uuid.UUID, accept: bool) -> Report:
    report = await session.get(Report, report_id)
    if report is None:
        raise HTTPException(404, "Denúncia não encontrada.")
    now = datetime.now(UTC)
    if accept:
        await delete_target(session, report.target_type, report.target_id)
        # Os outros pedidos do mesmo conteúdo também se resolvem.
        others = await session.scalars(
            select(Report).where(
                Report.target_id == report.target_id, Report.status == "pending"
            )
        )
        for other in others:
            other.status, other.resolved_at = "accepted", now
    report.status, report.resolved_at = ("accepted" if accept else "rejected"), now
    await session.flush()
    return report


ReportServiceDep = Annotated[ReportService, Depends()]
