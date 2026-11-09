"""Operações seguras do painel: atividade ao vivo, infraestrutura, caches públicos e manutenção.

Nada aqui executa comando, SQL livre ou controla o servidor. Reiniciar processos ou contêineres exige um
orquestrador separado e restrito (ainda não existe): por isso não há botão de reiniciar.
"""

import os
from typing import Annotated, Literal

import psutil
from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api import maintenance, metrics, resilience
from api.core.config import settings
from api.db.main import DatabaseDep
from api.db.models import SystemFlag
from api.modules.admin import auth
from api.modules.admin.health import pool_status, resilience_status
from api.modules.admin.permissions import Principal
from api.modules.admin.service import log
from api.redis import redis_client

router = APIRouter(include_in_schema=False)
Operations = Annotated[Principal, auth.require_permission("operations")]
Owner = Annotated[Principal, auth.require_permission("owner")]
_PROCESS = psutil.Process(os.getpid())


async def _database(session: AsyncSession) -> dict:
    row = (
        await session.execute(
            text(
                "SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS connections,"
                " (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active') AS active,"
                " (SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a USING (pid) WHERE NOT l.granted AND a.datname = current_database()) AS waiting_locks,"
                " (SELECT current_setting('max_connections')::int) AS max_connections,"
                " pg_database_size(current_database()) AS size_bytes"
            )
        )
    ).one()
    return {
        "connections": row.connections,
        "active": row.active,
        "waiting_locks": row.waiting_locks,
        "max_connections": row.max_connections,
        "size_bytes": row.size_bytes,
    }


def _process() -> dict:
    me = _PROCESS
    children = me.children(recursive=True)
    parent = me.parent()
    # com `--workers`, o pai é o supervisor e este processo é um worker
    return {
        "pid": me.pid,
        "cpu_percent": me.cpu_percent(interval=None),
        "memory_bytes": me.memory_info().rss,
        "threads": me.num_threads(),
        "children": len(children),
        "parent_pid": parent.pid if parent else None,
    }


@router.get("/live")
async def live(_: Operations, db: DatabaseDep) -> dict:
    caches = resilience.counters()
    hits, misses = caches.get("cache.hit", 0), caches.get("cache.miss", 0)
    return {
        "activity": metrics.activity(),
        "process": _process(),
        "database": await db.read(_database),
        "pool": pool_status(),
        "origins": resilience_status(),
        "cache": {
            "hits": hits,
            "misses": misses,
            "hit_rate": round(hits / (hits + misses), 3) if hits + misses else None,
            "stale_served": caches.get("cache.stale_served", 0),
            "single_flight_shared": caches.get("single_flight.shared", 0),
        },
        "redis": {"configured": redis_client() is not None},
        "maintenance": await maintenance.enabled(force=True),
        "environment": settings.environment,
        "restart": {
            "available": False,
            "reason": "Exige um orquestrador separado e restrito (Docker), ainda não implantado.",
        },
    }


class CacheClear(BaseModel):
    target: Literal["units", "classrooms", "all"]


@router.post("/cache/clear")
async def clear_cache(actor: Operations, db: DatabaseDep, body: CacheClear) -> dict:
    from api.modules.public_classrooms import service

    cleared = []
    if body.target in {"units", "all"}:
        service.UNITS_CACHE.clear()
        cleared.append("units")
    if body.target in {"classrooms", "all"}:
        service.CLASSROOMS_CACHE.clear()
        cleared.append("classrooms")
    await db.write(
        lambda session: log(
            session,
            "admin.cache_cleared",
            "cache",
            None,
            ",".join(cleared),
            actor=actor,
        )
    )
    return {"cleared": cleared}


class MaintenanceChange(BaseModel):
    enabled: bool


@router.put("/maintenance")
async def set_maintenance(
    actor: Owner, db: DatabaseDep, body: MaintenanceChange
) -> dict:
    async def write(session: AsyncSession) -> None:
        flag = await session.get(SystemFlag, maintenance.KEY)
        if flag is None:
            session.add(SystemFlag(key=maintenance.KEY, enabled=body.enabled))
        else:
            flag.enabled = body.enabled
        await log(
            session,
            "admin.maintenance_on" if body.enabled else "admin.maintenance_off",
            "system",
            None,
            None,
            actor=actor,
        )

    await db.write(write)
    maintenance.invalidate()
    return {"maintenance": await maintenance.enabled(force=True)}
