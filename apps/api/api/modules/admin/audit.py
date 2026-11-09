"""Consulta paginada do registro imutável, sem decifrar nem pesquisar conteúdo de estudantes."""

from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated, Literal

from fastapi import Depends
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import func, select

from api.db.main import DatabaseDep
from api.db.models import AdminLog
from api.modules.admin.models import AdminAccount
from api.modules.admin.permissions import Role


class AuditQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: str = Field(default="", max_length=80)
    actor: str = Field(default="", max_length=64)
    role: Role | None = None
    target: str = Field(default="", max_length=32)
    since: date | None = None
    until: date | None = None
    order: Literal["newest", "oldest"] = "newest"
    page: int = Field(default=1, ge=1, le=100_000)
    page_size: int = Field(default=20, ge=10, le=100)

    @model_validator(mode="after")
    def dates(self):
        if self.since and self.until and self.since > self.until:
            raise ValueError("O início deve ser anterior ao fim.")
        return self


class LogEntry(BaseModel):
    action: str
    target_type: str | None
    target_id: str | None
    detail: str | None
    created_at: datetime
    actor: str | None = None
    actor_role: str | None = None


class LogPage(BaseModel):
    items: list[LogEntry]
    total: int
    page: int
    page_size: int


class AuditService:
    def __init__(self, db: DatabaseDep) -> None:
        self.db = db

    async def list(self, filters: AuditQuery) -> LogPage:
        async def read(session):
            query = select(AdminLog, AdminAccount.username).outerjoin(
                AdminAccount, AdminAccount.id == AdminLog.actor_id
            )
            for value, column in [
                (filters.action, AdminLog.action),
                (filters.actor, AdminAccount.username),
                (filters.target, AdminLog.target_type),
            ]:
                if value:
                    query = query.where(
                        column.icontains(value.strip(), autoescape=True)
                    )
            if filters.role:
                query = query.where(AdminLog.actor_role == filters.role)
            if filters.since:
                query = query.where(
                    AdminLog.created_at
                    >= datetime.combine(filters.since, time.min, UTC)
                )
            if filters.until:
                query = query.where(
                    AdminLog.created_at
                    < datetime.combine(filters.until, time.min, UTC) + timedelta(days=1)
                )
            total = await session.scalar(
                select(func.count()).select_from(query.subquery())
            )
            order = (AdminLog.created_at, AdminLog.id)
            if filters.order == "newest":
                order = tuple(column.desc() for column in order)
            rows = await session.execute(
                query.order_by(*order)
                .offset((filters.page - 1) * filters.page_size)
                .limit(filters.page_size)
            )
            return LogPage(
                items=[
                    LogEntry(
                        action=row.action,
                        target_type=row.target_type,
                        target_id=row.target_id,
                        detail=row.detail,
                        created_at=row.created_at,
                        actor=name,
                        actor_role=row.actor_role,
                    )
                    for row, name in rows
                ],
                total=total or 0,
                page=filters.page,
                page_size=filters.page_size,
            )

        return await self.db.read(read)


AuditServiceDep = Annotated[AuditService, Depends()]
