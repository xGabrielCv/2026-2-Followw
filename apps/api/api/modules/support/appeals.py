"""Vincula recursos anônimos aos chamados existentes, sem tornar a auditoria pública."""

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import Text, or_, select

from api.anonymous import owns
from api.db.context import use_context
from api.db.models import AdminLog, Report


async def reference(db, kind: str, identifier: UUID, proof: str | None):
    async def read(session):
        reports = select(Report.id).where(
            Report.target_type == kind, Report.target_id == identifier
        )
        query = (
            select(AdminLog)
            .where(
                or_(
                    (AdminLog.target_type == kind)
                    & (AdminLog.target_id == str(identifier))
                    & AdminLog.action.in_(
                        ("delete", "tutorial.reject", "tutorial.accept")
                    ),
                    (AdminLog.target_type == "report")
                    & AdminLog.target_id.in_(
                        select(Report.id.cast(Text)).where(Report.id.in_(reports))
                    )
                    & AdminLog.action.in_(("report.accept", "report.reject")),
                )
            )
            .order_by(AdminLog.created_at.desc(), AdminLog.id)
            .limit(1)
        )
        decision = await session.scalar(query)
        proven = bool(
            proof and decision and owns(decision.content_proof, proof, "resource")
        )
        if proof:
            from api.modules.reports.service import TARGETS

            row = await session.get(TARGETS[kind], identifier)
            if row:
                verifier = getattr(row, "uploader_key", None) or getattr(
                    row, "author_key", None
                )
                proven = proven or owns(verifier, proof, "resource")
        return decision.id if decision else None, proven

    # Somente essa consulta fixa é privilegiada; nenhuma auditoria ou existência é devolvida ao público.
    with use_context(scope="admin"):
        return await db.read(read)


async def require_independent_reviewer(session, ticket, actor):
    if ticket.appeal_decision_id:
        decision = await session.get(AdminLog, ticket.appeal_decision_id)
        if decision and decision.actor_id == actor.id:
            raise HTTPException(
                409,
                "Outro integrante da equipe deve concluir o recurso da sua decisão.",
            )
