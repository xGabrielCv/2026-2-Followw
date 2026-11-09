"""Fila paginada e decisões justificadas, individuais ou em lote atômico."""

from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator
from sqlalchemy import func, select, text

from api.crypto import matches
from api.db.main import DatabaseDep
from api.db.models import AdminLog, Report, Tutorial
from api.db.pagination import paginate
from api.modules.admin import auth
from api.modules.admin.service import ReportView, TutorialView, _preview, log
from api.modules.reports.service import Reason, TargetType, resolve

router = APIRouter(dependencies=[auth.require_permission("moderate")])
SEARCH_WINDOW = 2000
SearchText = Annotated[str, Query(max_length=120)]
QueueOrder = Literal["newest", "oldest"]


@router.get("/moderation/summary")
async def summary(db: DatabaseDep) -> dict[str, int]:
    async def read(session):
        return {
            "reports": await session.scalar(
                select(func.count())
                .select_from(Report)
                .where(Report.status == "pending")
            )
            or 0,
            "tutorials": await session.scalar(
                select(func.count())
                .select_from(Tutorial)
                .where(Tutorial.status == "pending")
            )
            or 0,
        }

    return await db.read(read)


class Decision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["accept", "reject"]
    reason: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=3, max_length=300)
    ]


class BatchDecision(Decision):
    kind: Literal["report", "tutorial"]
    ids: list[UUID] = Field(min_length=1, max_length=20)

    @field_validator("ids")
    @classmethod
    def unique(cls, value):
        if len(set(value)) != len(value):
            raise ValueError("Itens repetidos no lote.")
        return sorted(value)


class DecisionRecord(BaseModel):
    action: str
    reason: str | None
    created_at: datetime


class ModeratedReport(ReportView):
    history: list[DecisionRecord]


class ModeratedTutorial(TutorialView):
    history: list[DecisionRecord]


class ModerationPage[T](BaseModel):
    items: list[T]
    total: int
    page: int
    page_size: int
    search_limited: bool = False


async def queue_page(session, query, model, q, order, page, page_size, fields):
    columns = (model.created_at, model.id)
    ordered = query.order_by(
        *(column.desc() if order == "newest" else column for column in columns)
    )
    if not q.strip():
        rows, total = await paginate(session, ordered, page, page_size)
        return rows, total, False
    # O texto cifrado é filtrado só em memória, com janela explícita e limitada.
    candidates = list(
        await session.scalars(
            query.order_by(model.created_at.desc(), model.id.desc()).limit(
                SEARCH_WINDOW + 1
            )
        )
    )
    limited = len(candidates) > SEARCH_WINDOW
    found = [
        row
        for row in candidates[:SEARCH_WINDOW]
        if matches(q.strip(), *(str(getattr(row, field) or "") for field in fields))
    ]
    if order == "oldest":
        found.reverse()
    offset = (page - 1) * page_size
    return found[offset : offset + page_size], len(found), limited


async def history(session, kind: str, ids) -> dict[str, list[DecisionRecord]]:
    keys = [str(value) for value in ids]
    if not keys:
        return {}
    rows = await session.scalars(
        select(AdminLog)
        .where(
            AdminLog.target_type == kind,
            AdminLog.target_id.in_(keys),
            AdminLog.action.in_(
                [
                    f"{kind}.accept",
                    f"{kind}.reject",
                    "tutorial.approve",
                    "tutorial.reject",
                ]
            ),
        )
        .order_by(AdminLog.created_at.desc())
        .limit(200)
    )
    result: dict[str, list[DecisionRecord]] = {}
    for row in rows:
        entries = result.setdefault(row.target_id, [])
        if len(entries) < 5:
            entries.append(
                DecisionRecord(
                    action=row.action, reason=row.detail, created_at=row.created_at
                )
            )
    return result


@router.get("/reports")
async def reports(
    db: DatabaseDep,
    status: Literal["pending", "accepted", "rejected"] = "pending",
    reason: Reason | None = None,
    target: TargetType | None = None,
    q: SearchText = "",
    order: QueueOrder = "newest",
    page: Annotated[int, Query(ge=1, le=100000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> ModerationPage[ModeratedReport]:
    async def read(session):
        query = select(Report).where(Report.status == status)
        if reason:
            query = query.where(Report.reason == reason)
        if target:
            query = query.where(Report.target_type == target)
        rows, total, limited = await queue_page(
            session,
            query,
            Report,
            q,
            order,
            page,
            page_size,
            ("message", "target_id", "reason"),
        )
        previous = await history(session, "report", [row.id for row in rows])
        items = [
            ModeratedReport(
                id=row.id,
                target_type=row.target_type,
                target_id=row.target_id,
                reason=row.reason,
                message=row.message,
                status=row.status,
                created_at=row.created_at,
                preview=await _preview(session, row.target_type, row.target_id),
                history=previous.get(str(row.id), []),
            )
            for row in rows
        ]
        return ModerationPage(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            search_limited=limited,
        )

    return await db.read(read)


@router.get("/tutorials")
async def tutorials(
    db: DatabaseDep,
    status: Literal["pending", "approved", "rejected"] = "pending",
    q: SearchText = "",
    order: QueueOrder = "newest",
    page: Annotated[int, Query(ge=1, le=100000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> ModerationPage[ModeratedTutorial]:
    async def read(session):
        rows, total, limited = await queue_page(
            session,
            select(Tutorial).where(Tutorial.status == status),
            Tutorial,
            q,
            order,
            page,
            page_size,
            ("title", "summary", "body"),
        )
        previous = await history(session, "tutorial", [row.id for row in rows])
        return ModerationPage(
            items=[
                ModeratedTutorial(
                    id=row.id,
                    title=row.title,
                    summary=row.summary,
                    body=row.body,
                    category=row.category,
                    status=row.status,
                    created_at=row.created_at,
                    history=previous.get(str(row.id), []),
                )
                for row in rows
            ],
            total=total,
            page=page,
            page_size=page_size,
            search_limited=limited,
        )

    return await db.read(read)


async def decide(session, kind: str, id_: UUID, body: Decision, actor) -> None:
    if kind == "report":
        await resolve(session, id_, body.action == "accept")
    else:
        row = await session.get(Tutorial, id_)
        if row is None:
            raise HTTPException(404, "Guia não encontrado.")
        row.status = "approved" if body.action == "accept" else "rejected"
        row.approved_at = datetime.now(UTC) if body.action == "accept" else None
    await log(session, f"{kind}.{body.action}", kind, id_, body.reason, actor=actor)


@router.post("/reports/{id_}", status_code=204)
async def decide_report(
    id_: UUID, body: Decision, request: Request, db: DatabaseDep
) -> None:
    async def write(session):
        await session.execute(text("SELECT pg_advisory_xact_lock(865942119)"))
        row = await session.get(Report, id_)
        if row is None:
            raise HTTPException(404, "Denúncia não encontrada.")
        if row.status != "pending":
            raise HTTPException(409, "Esta denúncia já foi decidida; atualize a fila.")
        await decide(session, "report", id_, body, request.state.admin)

    await db.write(write)


@router.post("/tutorials/{id_}", status_code=204)
async def decide_tutorial(
    id_: UUID, body: Decision, request: Request, db: DatabaseDep
) -> None:
    await db.write(
        lambda session: decide(session, "tutorial", id_, body, request.state.admin)
    )


@router.post("/moderation/batch")
async def batch(
    body: BatchDecision, request: Request, db: DatabaseDep
) -> dict[str, int]:
    async def write(session):
        await session.execute(text("SELECT pg_advisory_xact_lock(865942119)"))
        model = Report if body.kind == "report" else Tutorial
        rows = list(
            await session.scalars(
                select(model)
                .where(model.id.in_(body.ids))
                .order_by(model.id)
                .with_for_update()
            )
        )
        if len(rows) != len(body.ids):
            raise HTTPException(
                404, "Um dos itens não foi encontrado; nenhum foi alterado."
            )
        if any(row.status != "pending" for row in rows):
            raise HTTPException(409, "A fila mudou; atualize antes de decidir em lote.")
        for id_ in body.ids:
            await decide(session, body.kind, id_, body, request.state.admin)
        return {"processed": len(rows)}

    return await db.write(write)
