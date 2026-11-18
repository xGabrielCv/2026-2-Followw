"""Pool compartilhado de conexões HTTP/TLS para fontes externas (SIGAA e UnB).

Cada requisição continua com seu próprio `httpx.AsyncClient` (cookies, cabeçalhos e redirecionamentos
exclusivos daquela chamada), mas reaproveita o mesmo contexto TLS e as conexões TCP keep-alive do
worker, com limite global de concorrência para não esgotar sockets nem martelar a origem.
"""

import asyncio
import ssl
from functools import lru_cache
from weakref import WeakKeyDictionary

import httpx
from fastapi import HTTPException

from api.core.config import settings
from api.logger import event


@lru_cache(maxsize=1)
def shared_ssl_context() -> ssl.SSLContext:
    """Carrega a cadeia de certificados uma única vez por processo."""
    return httpx.create_ssl_context()


class _LoopPool:
    def __init__(self) -> None:
        self.transport = httpx.AsyncHTTPTransport(
            verify=shared_ssl_context(),
            limits=httpx.Limits(
                max_connections=settings.sigaa_http_max_connections,
                max_keepalive_connections=settings.sigaa_http_keepalive_connections,
                keepalive_expiry=30.0,
            ),
        )
        self.semaphore = asyncio.Semaphore(settings.sigaa_max_concurrent_requests)

    async def aclose(self) -> None:
        await self.transport.aclose()


_POOLS: WeakKeyDictionary[asyncio.AbstractEventLoop, _LoopPool] = WeakKeyDictionary()


def _current_pool() -> _LoopPool:
    loop = asyncio.get_running_loop()
    pool = _POOLS.get(loop)
    if pool is None:
        pool = _POOLS[loop] = _LoopPool()
    return pool


class BorrowedAsyncTransport(httpx.AsyncBaseTransport):
    """Empresta o pool do loop atual sem fechá-lo ao encerrar o `AsyncClient` da requisição."""

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        pool = _current_pool()
        try:
            async with asyncio.timeout(settings.sigaa_queue_timeout_seconds):
                await pool.semaphore.acquire()
        except TimeoutError:
            event("sigaa.outbound_pool_saturated")
            raise HTTPException(
                status_code=503,
                detail="Muitas consultas simultâneas ao SIGAA. Tente novamente em instantes.",
                headers={"Retry-After": "5", "Cache-Control": "no-store"},
            ) from None
        try:
            return await pool.transport.handle_async_request(request)
        finally:
            pool.semaphore.release()

    async def aclose(self) -> None:
        return None


def borrowed_transport() -> BorrowedAsyncTransport:
    return BorrowedAsyncTransport()


async def close() -> None:
    """Fecha o pool de transporte do event loop atual no encerramento do processo."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    pool = _POOLS.pop(loop, None)
    if pool is not None:
        await pool.aclose()
