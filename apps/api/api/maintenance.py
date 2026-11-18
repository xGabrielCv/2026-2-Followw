"""Modo de manutenção: o Owner liga e a API responde 503 a tudo, menos ao painel e à saúde.

O estado é lido do banco com validade curta (5 s), então vale em todos os processos sem reiniciar nada.
"""

import time

from sqlalchemy import select
from starlette._utils import get_route_path
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from api.db.main import async_session
from api.db.models import SystemFlag, SystemText
from api.resilience import SingleFlight

KEY = "maintenance"
MESSAGE_KEY = "maintenance_message"
DEFAULT_MESSAGE = "O Followw está em manutenção. Volte em alguns minutos."
_CACHE: dict[str, object] = {"on": False, "message": DEFAULT_MESSAGE, "at": 0.0}
_TTL = 5.0
_OPEN = ("/admin", "/public/config")
_FLIGHT = SingleFlight()


async def _query_state() -> tuple[bool, str]:
    on = False
    message = DEFAULT_MESSAGE
    try:
        async with async_session() as session:
            row = await session.scalar(
                select(SystemFlag.enabled).where(SystemFlag.key == KEY)
            )
            custom = await session.scalar(
                select(SystemText.value).where(SystemText.key == MESSAGE_KEY)
            )
            on = bool(row)
            if custom and custom.strip():
                message = custom.strip()
    except Exception:  # noqa: BLE001 — sem banco, não decide manutenção
        on = False
    _CACHE.update(on=on, message=message, at=time.monotonic())
    return on, message


async def status(force: bool = False) -> tuple[bool, str]:
    if not force and time.monotonic() - float(_CACHE.get("at", 0.0)) < _TTL:  # type: ignore[arg-type]
        return bool(_CACHE.get("on")), str(_CACHE.get("message") or DEFAULT_MESSAGE)
    return await _FLIGHT.run("maintenance", _query_state)


async def enabled(force: bool = False) -> bool:
    return (await status(force=force))[0]


def invalidate() -> None:
    _CACHE["at"] = 0.0


class MaintenanceMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and not get_route_path(scope).startswith(_OPEN):
            on, detail = await status()
            if on:
                response = JSONResponse(
                    {"detail": detail},
                    status_code=503,
                    headers={"Retry-After": "120", "Cache-Control": "no-store"},
                )
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
