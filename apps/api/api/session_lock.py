"""Bloqueio da sessão SIGAA entre workers e réplicas, com advisory lock do PostgreSQL.

Uma sessão SIGAA guarda no servidor deles a tela aberta: duas requisições do mesmo aluno ao mesmo tempo, em
workers diferentes, misturariam as telas. O `asyncio.Lock` em memória só vale dentro de um processo; este
bloqueio vale para todos.

- a chave é um número derivado por HMAC (com chave do servidor) do identificador da sessão: nada de matrícula
  ou senha é gravado, e o número só existe em `pg_locks` enquanto a requisição dura;
- o lock é da CONEXÃO: se o processo morre, a conexão cai e o PostgreSQL o solta sozinho (sem lock órfão);
- espera com tempo máximo e jitter; passou dele, o chamador responde 503 (nunca segue "como se tivesse" o lock);
- usa um engine próprio e pequeno para não tomar conexões do pool das requisições normais.
"""

import asyncio
import hmac
import random
import time

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, create_async_engine

from api.cookies import derive_key
from api.core.config import settings

_engine: AsyncEngine | None = None


def lock_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = create_async_engine(
            settings.database_url,
            pool_size=settings.session_lock_pool,
            max_overflow=0,
            pool_pre_ping=True,
            hide_parameters=True,
        )
    return _engine


def lock_key(name: str) -> int:
    """Inteiro de 64 bits (o tipo do advisory lock), sem relação reversível com o nome."""
    digest = hmac.digest(derive_key("followw:session-lock"), name.encode(), "sha256")
    return int.from_bytes(digest[:8], "big", signed=True)


class HeldLock:
    def __init__(self, connection: AsyncConnection, key: int) -> None:
        self._connection, self._key = connection, key

    async def release(self) -> None:
        try:
            await self._connection.execute(
                text("SELECT pg_advisory_unlock(:k)"), {"k": self._key}
            )
        except Exception:  # noqa: BLE001 — sem certeza de que soltou: descarta a conexão inteira
            await self._connection.invalidate()
        finally:
            await self._connection.close()


async def acquire(
    name: str, timeout: float, engine: AsyncEngine | None = None
) -> HeldLock:
    """Espera até `timeout` segundos; levanta `TimeoutError` se não conseguir."""
    key = lock_key(name)
    connection = await (engine or lock_engine()).connect()
    # sem transação aberta enquanto segura o lock (não fica "idle in transaction" por até 90 s)
    connection = await connection.execution_options(isolation_level="AUTOCOMMIT")
    deadline = time.monotonic() + timeout
    try:
        while True:
            if await connection.scalar(
                text("SELECT pg_try_advisory_lock(:k)"), {"k": key}
            ):
                return HeldLock(connection, key)
            if time.monotonic() >= deadline:
                raise TimeoutError(name)
            await asyncio.sleep(0.03 + random.random() * 0.05)
    except BaseException:
        await connection.close()
        raise
