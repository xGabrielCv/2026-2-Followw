import asyncio
import hmac
import logging
import os
from dataclasses import dataclass
from ipaddress import ip_address, ip_network
from math import ceil
from time import time

from fastapi import Depends, HTTPException
from starlette._utils import get_route_path
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send
from upstash_ratelimit.asyncio import FixedWindow, Ratelimit, Response

from api.cookies import derive_key
from api.core.config import settings
from api.logger import event
from api.redis import redis_client


class RateLimitMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] == "OPTIONS":
            await self.app(scope, receive, send)
            return

        method = scope["method"]
        path = get_route_path(scope).rstrip("/")
        group, limit = _quota(method, path)
        result = await _limit(
            group,
            _bucket(_client_host(Request(scope))),
            limit,
            settings.rate_limit_window_seconds,
        )
        if result is not None and not result.allowed:
            # Sair sempre apaga os cookies; só a chamada ao SIGAA fica de fora.
            if method == "DELETE" and path == "/auth/sigaa":
                scope.setdefault("state", {})["rate_limited"] = True
            else:
                response = JSONResponse(
                    status_code=429,
                    content={"detail": "Too many requests"},
                    headers=_retry_headers(result),
                )
                await response(scope, receive, send)
                return

        await self.app(scope, receive, send)


def _quota(method: str, path: str) -> tuple[str, int]:
    return {
        ("POST", "/auth/sigaa"): ("login", settings.rate_limit_login_requests),
        ("POST", "/auth/sigaa/refresh"): (
            "refresh",
            settings.rate_limit_refresh_requests,
        ),
    }.get((method, path), ("api", settings.rate_limit_requests))


async def limit_registration(registration: str) -> None:
    """Cota de tentativas por matrícula, de qualquer IP, além da cota de login do IP."""
    result = await _limit(
        "registration",
        registration,
        settings.rate_limit_registration_requests,
        settings.rate_limit_registration_window_seconds,
    )
    if result is not None and not result.allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many requests",
            headers=_retry_headers(result),
        )


async def limit_by(group: str, key: str, limit: int, window_seconds: int) -> None:
    """Cota própria de um recurso (ex.: tentativas de recuperação de um chamado), de qualquer IP."""
    result = await _limit(group, key, limit, window_seconds)
    if result is not None and not result.allowed:
        raise HTTPException(
            status_code=429,
            detail="Too many requests",
            headers=_retry_headers(result),
        )


def _retry_headers(result: Response | _MemoryResult) -> dict[str, str]:
    return {
        "Retry-After": str(max(1, ceil(result.reset - time()))),
        "Cache-Control": "no-store",
    }


@dataclass
class _Window:
    reset: float
    count: int


@dataclass(frozen=True)
class _MemoryResult:
    allowed: bool
    reset: float


# Sem Redis em produção (ex.: uma VPS só), a cota fica na memória do processo.
_MEMORY: dict[tuple[str, str], _Window] = {}
_MEMORY_MAX_KEYS = 50_000


def _memory_limit(group: str, key: str, limit: int, window: int) -> _MemoryResult:
    now = time()
    if len(_MEMORY) >= _MEMORY_MAX_KEYS:
        for stale in [k for k, w in _MEMORY.items() if now >= w.reset]:
            del _MEMORY[stale]
    current = _MEMORY.get((group, key))
    if current is None or now >= current.reset:
        if current is None and len(_MEMORY) >= _MEMORY_MAX_KEYS:
            return _MemoryResult(False, now + window)
        current = _MEMORY[(group, key)] = _Window((now // window + 1) * window, 0)
    current.count += 1
    return _MemoryResult(current.count <= limit, current.reset)


async def _limit(
    group: str, key: str, limit: int, window: int
) -> Response | _MemoryResult:
    identifier = hmac.digest(
        derive_key("followw:rate-limit"), key.encode(), "sha256"
    ).hex()
    # Conta também durante operação normal para impedir cota nova ao cair o Redis.
    local = _memory_limit(group, identifier, limit, window)
    if not local.allowed:
        return local
    redis = redis_client()
    if redis is None:
        return local
    try:
        async with asyncio.timeout(settings.redis_timeout_seconds):
            return await Ratelimit(
                redis=redis,
                limiter=FixedWindow(max_requests=limit, window=window),
                prefix=f"followw:{settings.environment}:rate-limit:{group}",
            ).limit(identifier)
    except Exception as error:  # noqa: BLE001 — Redis é opcional.
        event(
            "rate_limit.unavailable",
            level=logging.WARNING,
            error_type=type(error).__name__,
        )
        return local


def reset_memory() -> None:
    """Zera as cotas em memória (testes)."""
    _MEMORY.clear()


def publish_quota(group: str, limit: int, window_seconds: int = 3600):
    """Cota de publicação por origem de rede, temporária e sem relação com conta ou aparelho.

    Substitui o limite "por aluno" que exigia um identificador estável: o IP só vive na janela da cota
    (memória/Redis, com expiração) e nunca é gravado junto de uma publicação.
    """

    async def check(request: Request) -> None:
        if request.method == "OPTIONS":
            return
        await limit_by(
            f"publish:{group}", _bucket(_client_host(request)), limit, window_seconds
        )

    return Depends(check)


def _bucket(host: str) -> str:
    try:
        address = ip_address(host)
    except ValueError:
        return host
    # Um cliente IPv6 controla o /64 inteiro.
    if address.version == 6:
        return str(address.ipv4_mapped or ip_network(f"{address}/64", strict=False))
    return str(address)


def _client_host(request: Request) -> str:
    host = request.client.host if request.client else "unknown"
    # Só a Vercel sobrescreve este cabeçalho; fora dela, confie no servidor ASGI.
    if os.environ.get("VERCEL") == "1":
        host = request.headers.get("x-vercel-forwarded-for", host).split(",")[0].strip()

    secret = settings.rate_limit_secret_key
    forwarded = request.headers.get("x-followw-client")
    signature = request.headers.get("x-followw-client-signature")
    if not secret or not forwarded or not signature:
        return host

    expected = hmac.digest(
        secret.encode(), f"followw:rate-limit:{forwarded}".encode(), "sha256"
    ).hex()
    try:
        timestamp, _, address = forwarded.partition(":")
        if (
            hmac.compare_digest(signature.encode(), expected.encode())
            and abs(time() - int(timestamp)) <= 60
        ):
            host = str(ip_address(address))
    except ValueError, OverflowError:
        pass
    return host
