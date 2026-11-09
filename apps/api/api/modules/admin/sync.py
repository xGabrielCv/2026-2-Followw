"""Sincronização e catálogos: estado, histórico, horários e execução manual em segundo plano."""

from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings as runtime_settings
from api.db.main import DatabaseDep
from api.db.models import (
    ClassroomGroup,
    ForumPost,
    ForumReply,
    Material,
    ProfessorReview,
    Report,
    SystemText,
    Tutorial,
)
from api.modules.admin import auth
from api.modules.admin.service import log
from api.modules.sync import service
from api.modules.sync.models import SyncRun, SyncState
from api.modules.sync.schedule import BRASILIA, SOURCES, SyncSettings
from api.modules.sync.scheduler import get_scheduler

router = APIRouter()
Source = Literal["catalog", "restaurant"]
Resource = Literal["all", "professors", "offers", "subjects", "curricula", "units"]


class SourceState(BaseModel):
    key: str
    label: str
    enabled: bool
    scheduled_times: list[str]
    running: bool
    last_attempt_at: datetime | None
    last_success_at: datetime | None
    last_change_at: datetime | None
    next_run_at: datetime | None
    records: int | None
    last_status: str | None
    consecutive_failures: int


class RunView(BaseModel):
    id: str
    source: str
    trigger: str
    status: str
    started_at: datetime
    finished_at: datetime | None
    changed: bool
    records: int | None
    error: str | None
    resource: str = "all"
    metrics: dict[str, int] = {}


class Overview(BaseModel):
    timezone: str
    settings: SyncSettings
    sources: list[SourceState]
    history: list[RunView]
    scheduler_enabled: bool


class Activity(BaseModel):
    resource: str
    label: str
    # Hora cheia (sem minutos): a última atividade só aparece de forma agregada.
    last_activity_hour: datetime | None
    last_24_hours: int
    total: int


def _state(source: str, row: SyncState | None, settings, running: bool) -> SourceState:
    return SourceState(
        key=source,
        label=SOURCES[source],
        enabled=settings.enabled_for(source),
        scheduled_times=settings.times_for(source),
        running=running
        or bool(row and row.lease_until and row.lease_until > datetime.now(UTC)),
        last_attempt_at=row.last_attempt_at if row else None,
        last_success_at=row.last_success_at if row else None,
        last_change_at=row.last_change_at if row else None,
        next_run_at=row.next_run_at if row else None,
        records=row.records if row else None,
        last_status=row.last_status if row else None,
        consecutive_failures=row.consecutive_failures if row else 0,
    )


def _run_view(row: SyncRun) -> RunView:
    return RunView(
        id=str(row.id),
        source=row.source,
        trigger=row.trigger,
        status=row.status,
        started_at=row.started_at,
        finished_at=row.finished_at,
        changed=row.changed,
        records=row.records,
        error=row.error,
        resource=row.resource,
        metrics=row.metrics,
    )


@router.get("", dependencies=[auth.require_permission("operations")])
async def overview(db: DatabaseDep) -> Overview:
    scheduler = get_scheduler()

    async def read(session: AsyncSession) -> Overview:
        settings = await service.load_settings(session)
        states = {row.source: row for row in await session.scalars(select(SyncState))}
        runs = await session.scalars(
            select(SyncRun).order_by(SyncRun.started_at.desc()).limit(50)
        )
        running = set(scheduler.running())
        return Overview(
            timezone=str(BRASILIA),
            settings=settings,
            sources=[
                _state(key, states.get(key), settings, key in running)
                for key in SOURCES
            ],
            history=[_run_view(row) for row in runs],
            scheduler_enabled=runtime_settings.sync_scheduler_enabled
            if runtime_settings.sync_scheduler_enabled is not None
            else runtime_settings.environment != "testing",
        )

    return await db.read(read)


@router.get("/history", dependencies=[auth.require_permission("operations")])
async def history(
    db: DatabaseDep,
    source: Source | None = None,
    status: Literal["running", "success", "unchanged", "failed", "skipped", "cancelled"]
    | None = None,
    page: int = Query(1, ge=1, le=1000),
    page_size: int = Query(25, ge=1, le=100),
) -> dict:
    async def read(session: AsyncSession) -> dict:
        query = select(SyncRun)
        count = select(func.count()).select_from(SyncRun)
        for column, value in ((SyncRun.source, source), (SyncRun.status, status)):
            if value:
                query = query.where(column == value)
                count = count.where(column == value)
        rows = await session.scalars(
            query.order_by(SyncRun.started_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return {
            "items": [_run_view(row) for row in rows],
            "total": await session.scalar(count) or 0,
            "page": page,
            "page_size": page_size,
        }

    return await db.read(read)


@router.put("/settings", dependencies=[auth.require_permission("configure")])
async def update_settings(
    body: SyncSettings, request: Request, db: DatabaseDep
) -> SyncSettings:
    async def write(session: AsyncSession) -> SyncSettings:
        await service.save_settings(session, body)
        for source in SOURCES:
            await service.ensure_state(session, source, datetime.now(UTC), body)
            await service.reschedule(session, body, source)
        await log(
            session,
            "sync.settings",
            detail=body.model_dump_json(),
            actor=request.state.admin,
        )
        return body

    return await db.write(write)


@router.post(
    "/{source}/run",
    status_code=202,
    dependencies=[auth.require_permission("operations")],
)
async def run_now(
    source: Source, request: Request, db: DatabaseDep, resource: Resource = "all"
) -> dict[str, str]:
    """Começa em segundo plano e responde na hora; o resultado aparece no histórico."""
    if source not in SOURCES:
        raise HTTPException(404, "Fonte desconhecida.")
    if source != "catalog" and resource != "all":
        raise HTTPException(422, "O RU não possui esse recurso de catálogo.")
    outcome = await get_scheduler().trigger(source, resource, actor=request.state.admin)
    if outcome == "busy":
        raise HTTPException(409, "Esta fonte já está sincronizando.")
    if outcome == "cooldown":
        raise HTTPException(
            429, "Aguarde um pouco antes de sincronizar esta fonte de novo."
        )

    return {"status": "started", "source": source}


@router.post(
    "/{source}/cancel",
    status_code=202,
    dependencies=[auth.require_permission("operations")],
)
async def cancel(source: Source, request: Request, db: DatabaseDep) -> dict:
    if not await get_scheduler().cancel(source, actor=request.state.admin):
        raise HTTPException(409, "Não há execução ativa para cancelar.")

    return {"status": "cancelling", "source": source}


@router.get("/resources", dependencies=[auth.require_permission("operations")])
async def resources(db: DatabaseDep) -> list[Activity]:
    """Última atividade agregada de cada recurso da comunidade, sem quem a fez."""
    now = datetime.now(UTC)
    since = now - timedelta(hours=24)
    models = (
        ("forum", "Conversas e dúvidas", ForumPost),
        ("materials", "Materiais", Material),
        ("reviews", "Avaliações de docentes", ProfessorReview),
        ("tutorials", "Guias", Tutorial),
        ("reports", "Denúncias", Report),
        ("groups", "Grupos de turmas", ClassroomGroup),
    )

    async def read(session: AsyncSession) -> list[Activity]:
        items = []
        for key, label, model in models:
            last = await session.scalar(select(func.max(model.updated_at)))
            deletion = await session.get(SystemText, f"activity.{key}")
            if deletion:
                try:
                    deleted_at = datetime.fromisoformat(deletion.value)
                    if deleted_at.tzinfo:
                        last = max(last, deleted_at) if last else deleted_at
                except ValueError:
                    pass
            if key == "forum":
                reply_at = await session.scalar(select(func.max(ForumReply.updated_at)))
                if reply_at:
                    last = max(last, reply_at) if last else reply_at
            recent = await session.scalar(
                select(func.count()).select_from(model).where(model.updated_at >= since)
            )
            total = await session.scalar(select(func.count()).select_from(model))
            items.append(
                Activity(
                    resource=key,
                    label=label,
                    last_activity_hour=last.replace(minute=0, second=0, microsecond=0)
                    if last
                    else None,
                    last_24_hours=recent or 0,
                    total=total or 0,
                )
            )
        return items

    return await db.read(read)
