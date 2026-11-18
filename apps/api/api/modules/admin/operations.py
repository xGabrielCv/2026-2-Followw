"""Operações seguras do painel: atividade ao vivo, infraestrutura, caches públicos e manutenção.

Nada aqui executa comando, SQL livre ou controla o servidor. Reiniciar processos ou contêineres exige um
orquestrador separado e restrito (ainda não existe): por isso não há botão de reiniciar.
"""

import os
from typing import Annotated, Literal

import psutil
from fastapi import APIRouter, HTTPException, Path
from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api import http_pool, maintenance, metrics, rate_limit, resilience, session_lock
from api.core.config import settings
from api.db.main import DatabaseDep
from api.db.models import SystemFlag, SystemText
from api.modules.admin import auth
from api.modules.admin.health import origin_guards, pool_status, resilience_status
from api.modules.admin.permissions import Principal
from api.modules.admin.service import log
from api.redis import redis_client
from api.system_banner import (
    SystemBannerConfig,
    SystemBannerInput,
    read_banner_config,
    save_banner_config,
)

router = APIRouter(include_in_schema=False)
Operations = Annotated[Principal, auth.require_permission("operations")]
Configure = Annotated[Principal, auth.require_permission("configure")]
Owner = Annotated[Principal, auth.require_permission("owner")]
_PROCESS = psutil.Process(os.getpid())


async def _database(session: AsyncSession) -> dict:
    row = (
        await session.execute(
            text(
                "SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS connections,"
                " (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'active') AS active,"
                " (SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a USING (pid) WHERE NOT l.granted AND a.datname = current_database()) AS waiting_locks,"
                " (SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a USING (pid) WHERE l.locktype = 'advisory' AND l.granted AND a.datname = current_database()) AS advisory_locks,"
                " (SELECT count(*) FROM rate_windows) AS rate_windows,"
                " (SELECT current_setting('max_connections')::int) AS max_connections,"
                " pg_database_size(current_database()) AS size_bytes"
            )
        )
    ).one()
    return {
        "connections": row.connections,
        "active": row.active,
        "waiting_locks": row.waiting_locks,
        "advisory_locks": row.advisory_locks,
        "rate_windows": row.rate_windows,
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
    db_info, banner = await db.read(lambda session: _live_db_and_banner(session))
    maint_on, maint_message = await maintenance.status(force=True)
    rl = rate_limit.status()
    rl["postgres_windows"] = db_info.get("rate_windows", 0)
    sl = session_lock.pool_status()
    sl["active_advisory_locks"] = db_info.get("advisory_locks", 0)
    return {
        "activity": metrics.activity(),
        "process": _process(),
        "database": db_info,
        "pool": pool_status(),
        "http_pool": http_pool.pool_status(),
        "session_lock": sl,
        "rate_limit": rl,
        "origins": resilience_status(),
        "cache": {
            "hits": hits,
            "misses": misses,
            "hit_rate": round(hits / (hits + misses), 3) if hits + misses else None,
            "stale_served": caches.get("cache.stale_served", 0),
            "single_flight_shared": caches.get("single_flight.shared", 0),
        },
        "redis": {"configured": redis_client() is not None},
        "maintenance": maint_on,
        "maintenance_message": maint_message,
        "banner": banner.model_dump(mode="json"),
        "environment": settings.environment,
        "restart": {
            "available": False,
            "reason": "Exige um orquestrador separado e restrito (Docker), ainda não implantado.",
        },
    }


async def _live_db_and_banner(
    session: AsyncSession,
) -> tuple[dict, SystemBannerConfig]:
    return await _database(session), await read_banner_config(session)


class CacheClear(BaseModel):
    target: Literal["units", "classrooms", "subjects", "all"]


@router.post("/cache/clear")
async def clear_cache(actor: Operations, db: DatabaseDep, body: CacheClear) -> dict:
    from api.modules.public_classrooms import service
    from api.modules.public_subjects.router import SEARCH_RESPONSES

    cleared = []
    if body.target in {"units", "all"}:
        service.UNITS_CACHE.clear()
        cleared.append("units")
    if body.target in {"classrooms", "all"}:
        service.CLASSROOMS_CACHE.clear()
        cleared.append("classrooms")
    if body.target in {"subjects", "all"}:
        SEARCH_RESPONSES.clear()
        cleared.append("subjects")
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


@router.post("/origins/{origin_name}/recover")
async def recover_origin(
    actor: Operations,
    db: DatabaseDep,
    origin_name: Annotated[str, Path(pattern=r"^[a-z0-9_-]{2,40}$")],
) -> dict:
    guards = origin_guards()
    guard = guards.get(origin_name)
    if guard is None:
        raise HTTPException(404, "Origem desconhecida.")
    guard.breaker.success()
    await db.write(
        lambda session: log(
            session,
            "admin.origin_recovered",
            "origin",
            origin_name,
            actor=actor,
        )
    )
    return {"origin": origin_name, "circuit": guard.breaker.state}


class MaintenanceChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool
    message: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=240)] | None
    ) = None


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
        if body.message is not None:
            row = await session.get(SystemText, maintenance.MESSAGE_KEY)
            if row is None:
                session.add(SystemText(key=maintenance.MESSAGE_KEY, value=body.message))
            else:
                row.value = body.message
        await log(
            session,
            "admin.maintenance_on" if body.enabled else "admin.maintenance_off",
            "system",
            None,
            body.message or None,
            actor=actor,
        )

    await db.write(write)
    maintenance.invalidate()
    return {"maintenance": await maintenance.enabled(force=True)}


@router.get("/banner", response_model=SystemBannerConfig)
async def get_banner(_: Operations, db: DatabaseDep) -> SystemBannerConfig:
    return await db.read(read_banner_config)


@router.put("/banner", response_model=SystemBannerConfig)
async def put_banner(
    actor: Configure, db: DatabaseDep, body: SystemBannerInput
) -> SystemBannerConfig:
    async def write(session: AsyncSession) -> SystemBannerConfig:
        saved = await save_banner_config(session, body)
        await log(
            session,
            "admin.banner_updated",
            "system",
            "banner",
            f"enabled={saved.enabled};level={saved.level}",
            actor=actor,
        )
        return saved

    return await db.write(write)
