"""Visualizador de eventos técnicos: só leitura, do banco, com filtros e sem acesso a arquivos."""

from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import Text, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.db.main import DatabaseDep
from api.modules.admin import auth
from api.modules.logs.models import AppEvent
from api.modules.logs.sink import get_sink

router = APIRouter(dependencies=[auth.require_permission("audit")])
Level = Literal["INFO", "WARNING", "ERROR", "CRITICAL"]
EventName = Annotated[str, Query(pattern=r"^[a-z0-9_.]{1,80}$")]
Search = Annotated[str, Query(min_length=1, max_length=64)]


class EventView(BaseModel):
    id: str
    at: datetime
    level: str
    event: str
    fields: dict


class EventPage(BaseModel):
    items: list[EventView]
    total: int
    page: int
    page_size: int


class Summary(BaseModel):
    retention_days: int
    last_24_hours: dict[str, int]
    dropped_in_this_process: int


def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_")


@router.get("")
async def list_events(
    db: DatabaseDep,
    level: Level | None = None,
    event: EventName | None = None,
    q: Search | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    page: int = Query(1, ge=1, le=2000),
    page_size: int = Query(25, ge=1, le=100),
) -> EventPage:
    conditions = []
    if level:
        conditions.append(AppEvent.level == level)
    if event:
        conditions.append(AppEvent.event.startswith(event, autoescape=True))
    if q:
        like = f"%{_escape(q)}%"
        conditions.append(
            or_(
                AppEvent.event.ilike(like, escape="\\"),
                cast(AppEvent.fields, Text).ilike(like, escape="\\"),
            )
        )
    if since:
        conditions.append(AppEvent.at >= since)
    if until:
        conditions.append(AppEvent.at <= until)

    async def read(session: AsyncSession) -> EventPage:
        rows = await session.scalars(
            select(AppEvent)
            .where(*conditions)
            .order_by(AppEvent.at.desc(), AppEvent.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        total = await session.scalar(
            select(func.count()).select_from(AppEvent).where(*conditions)
        )
        return EventPage(
            items=[
                EventView(
                    id=str(row.id),
                    at=row.at,
                    level=row.level,
                    event=row.event,
                    fields=row.fields,
                )
                for row in rows
            ],
            total=total or 0,
            page=page,
            page_size=page_size,
        )

    return await db.read(read)


@router.get("/summary")
async def summary(db: DatabaseDep) -> Summary:
    since = datetime.now(UTC) - timedelta(hours=24)

    async def read(session: AsyncSession) -> dict[str, int]:
        rows = await session.execute(
            select(AppEvent.level, func.count())
            .where(AppEvent.at >= since)
            .group_by(AppEvent.level)
        )
        return {level: count for level, count in rows}

    return Summary(
        retention_days=settings.log_retention_days,
        last_24_hours=await db.read(read),
        dropped_in_this_process=get_sink().dropped,
    )
