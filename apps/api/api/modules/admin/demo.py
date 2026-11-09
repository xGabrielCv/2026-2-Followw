"""Dados de demonstração pelo painel: só o Owner, só fora de produção e só o que o namespace marca."""

import random
from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.db.context import apply_context, use_context
from api.db.main import DatabaseDep
from api.db.models import Classroom, SystemFlag
from api.modules.admin import auth
from api.modules.admin.service import log
from api.modules.demo.service import DemoStatus, _clear, _load, clear_records

router = APIRouter(dependencies=[auth.require_permission("owner")])
# Quantas turmas do semestre mais recente recebem grupos e conteúdo fictícios.
SAMPLE = 30


class DemoView(BaseModel):
    available: bool
    enabled: bool = False
    reason: str | None
    status: DemoStatus


def _unavailable() -> str | None:
    if settings.environment not in {"development", "testing"}:
        return "Desligado fora de desenvolvimento e teste local."
    from sqlalchemy.engine import make_url

    hosts = {"localhost", "127.0.0.1", "::1"}
    if (
        urlsplit(settings.public_url).hostname not in hosts
        or make_url(settings.database_url).host not in hosts
    ):
        return "Disponível somente em uma instância local com banco local."
    return None


def _require_local() -> None:
    reason = _unavailable()
    if reason:
        raise HTTPException(404, reason)


async def _enabled(db: DatabaseDep) -> bool:
    async def read(session: AsyncSession) -> bool:
        flag = await session.get(SystemFlag, "admin.demo.enabled")
        return flag.enabled if flag else settings.demo_data

    return await db.read(read)


async def _require(db: DatabaseDep) -> None:
    _require_local()
    if not await _enabled(db):
        raise HTTPException(
            409, "Ative a demonstração neste painel antes de carregar ou limpar."
        )


async def _status(db: DatabaseDep) -> DemoStatus:
    from api.modules.demo.service import DemoService

    with use_context(scope="demo"):
        return await DemoService(db).status()


@router.get("")
async def view(db: DatabaseDep) -> DemoView:
    reason = _unavailable()
    if reason:
        empty = DemoStatus(loaded=False, groups=0, reviews=0, classrooms=0)
        return DemoView(available=False, reason=reason, status=empty)
    return DemoView(
        available=True,
        enabled=await _enabled(db),
        reason=None,
        status=await _status(db),
    )


class DemoSettings(BaseModel):
    enabled: bool


@router.put("/settings")
async def configure(body: DemoSettings, request: Request, db: DatabaseDep) -> DemoView:
    _require_local()

    async def write(session: AsyncSession) -> None:
        from sqlalchemy.dialects.postgresql import insert

        statement = insert(SystemFlag).values(
            key="admin.demo.enabled", enabled=body.enabled
        )
        await session.execute(
            statement.on_conflict_do_update(
                index_elements=[SystemFlag.key],
                set_={"enabled": statement.excluded.enabled},
            )
        )
        await log(
            session,
            "demo.enable" if body.enabled else "demo.disable",
            target_type="demo",
            actor=request.state.admin,
        )

    await db.write(write)
    return await view(db)


@router.post("/load")
async def load(request: Request, db: DatabaseDep) -> DemoView:
    await _require(db)

    async def write(session: AsyncSession) -> None:
        await _populate(session)
        await _audit_in_transaction(session, request, "demo.load")

    with use_context(scope="demo"):
        await db.write(write)
    return await view(db)


async def _populate(session: AsyncSession) -> None:
    semester = await session.scalar(
        select(func.max(Classroom.semester)).where(Classroom.statistics.is_(None))
    )
    ids = list(
        await session.scalars(
            select(Classroom.id)
            .where(
                Classroom.semester == semester,
                Classroom.statistics.is_(None),
                Classroom.offer_active.is_(True),
            )
            .order_by(func.random())
            .limit(SAMPLE)
        )
    )
    if not ids:
        raise HTTPException(409, "O catálogo não tem turmas para a demonstração.")
    random.shuffle(ids)
    await _load(session, ids, ids)


@router.get("/preview")
async def preview(db: DatabaseDep) -> dict:
    _require_local()

    async def read(session):
        semester = await session.scalar(
            select(func.max(Classroom.semester)).where(
                Classroom.statistics.is_(None), Classroom.offer_active.is_(True)
            )
        )
        count = await session.scalar(
            select(func.count())
            .select_from(Classroom)
            .where(
                Classroom.semester == semester,
                Classroom.statistics.is_(None),
                Classroom.offer_active.is_(True),
            )
        )
        reason = None
        try:
            await clear_records(session, lock=False)
        except HTTPException as error:
            if error.status_code != 409:
                raise
            reason = error.detail
        return {
            "eligible_classrooms": min(count or 0, SAMPLE),
            "semester": semester,
            "can_clear": reason is None,
            "protection_reason": reason,
            "kinds": [
                "groups",
                "reviews",
                "materials",
                "posts",
                "tutorials",
                "classrooms",
            ],
        }

    return await db.read(read)


class DemoClear(BaseModel):
    confirmation: Literal["LIMPAR DEMONSTRAÇÃO"]


@router.delete("")
async def clear(body: DemoClear, request: Request, db: DatabaseDep) -> DemoView:
    await _require(db)

    async def write(session):
        await _clear(session)
        await _audit_in_transaction(session, request, "demo.clear")

    with use_context(scope="demo"):
        await db.write(write)
    return await view(db)


class DemoReload(BaseModel):
    confirmation: Literal["RECARREGAR DEMONSTRAÇÃO"]


@router.post("/reload")
async def reload(body: DemoReload, request: Request, db: DatabaseDep) -> DemoView:
    await _require(db)

    async def write(session):
        await _clear(session)
        await _populate(session)
        await _audit_in_transaction(session, request, "demo.reload")

    with use_context(scope="demo"):
        await db.write(write)
    return await view(db)


async def _audit_in_transaction(
    session: AsyncSession, request: Request, action: str
) -> None:
    with use_context(scope="admin"):
        await apply_context(session)
        await log(session, action, target_type="demo", actor=request.state.admin)
        await session.flush()
    await apply_context(session)
