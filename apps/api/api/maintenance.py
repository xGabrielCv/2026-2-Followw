"""Modo de manutenção: o Owner liga e a API responde 503 a tudo, menos ao painel e à saúde.

O estado é lido do banco com validade curta (5 s), então vale em todos os processos sem reiniciar nada.
"""

import time

from sqlalchemy import select
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from api.db.main import async_session
from api.db.models import SystemFlag

KEY = "maintenance"
_CACHE = {"on": False, "at": 0.0}
_TTL = 5.0
_OPEN = ("/admin", "/public/config")


async def enabled(force: bool = False) -> bool:
    if not force and time.monotonic() - _CACHE["at"] < _TTL:
        return bool(_CACHE["on"])
    try:
        async with async_session() as session:
            row = await session.scalar(
                select(SystemFlag.enabled).where(SystemFlag.key == KEY)
            )
    except Exception:  # noqa: BLE001 — sem banco, não decide manutenção
        row = None
    _CACHE.update(on=bool(row), at=time.monotonic())
    return bool(row)


def invalidate() -> None:
    _CACHE["at"] = 0.0


class MaintenanceMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] == "http"
            and not scope["path"].startswith(_OPEN)
            and await enabled()
        ):
            response = JSONResponse(
                {"detail": "O Followw está em manutenção. Volte em alguns minutos."},
                status_code=503,
                headers={"Retry-After": "120", "Cache-Control": "no-store"},
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)
