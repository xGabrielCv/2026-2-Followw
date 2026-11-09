"""Dados de demonstração pelo painel: só o Owner, só fora de produção e só o que o namespace marca."""

import random

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.config import settings
from api.db.context import use_context
from api.db.main import DatabaseDep
from api.db.models import Classroom
from api.modules.admin import auth
from api.modules.admin.service import log
from api.modules.demo.service import DemoStatus, _clear, _load

router = APIRouter(dependencies=[auth.require_permission("owner")])
# Quantas turmas do semestre mais recente recebem grupos e conteúdo fictícios.
SAMPLE = 30


class DemoView(BaseModel):
    available: bool
    reason: str | None
    status: DemoStatus


def _unavailable() -> str | None:
    if settings.environment == "production":
        return "Desligado em produção."
    if not settings.demo_data:
        return "Ligue DEMO_DATA=true neste ambiente para usar a demonstração."
    return None


def _require() -> None:
    reason = _unavailable()
    if reason:
        raise HTTPException(404, reason)


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
    return DemoView(available=True, reason=None, status=await _status(db))


@router.post("/load")
async def load(request: Request, db: DatabaseDep) -> DemoView:
    _require()

    async def write(session: AsyncSession) -> None:
        semester = await session.scalar(
            select(func.max(Classroom.semester)).where(Classroom.statistics.is_(None))
        )
        ids = list(
            await session.scalars(
                select(Classroom.id)
                .where(Classroom.semester == semester, Classroom.statistics.is_(None))
                .order_by(func.random())
                .limit(SAMPLE)
            )
        )
        if not ids:
            raise HTTPException(409, "O catálogo não tem turmas para a demonstração.")
        random.shuffle(ids)
        await _load(session, ids, ids)

    with use_context(scope="demo"):
        await db.write(write)
    await _audit(db, request, "demo.load")
    return DemoView(available=True, reason=None, status=await _status(db))


@router.delete("")
async def clear(request: Request, db: DatabaseDep) -> DemoView:
    _require()
    with use_context(scope="demo"):
        await db.write(_clear)
    await _audit(db, request, "demo.clear")
    return DemoView(available=True, reason=None, status=await _status(db))


async def _audit(db: DatabaseDep, request: Request, action: str) -> None:
    async def write(session: AsyncSession) -> None:
        await log(session, action, target_type="demo", actor=request.state.admin)

    await db.write(write)
