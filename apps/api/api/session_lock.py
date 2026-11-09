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
        except BaseException as error:
            await self._connection.invalidate()
            if isinstance(error, asyncio.CancelledError):
                raise
        finally:
            await self._connection.close()


async def acquire(
    name: str, timeout: float, engine: AsyncEngine | None = None
) -> HeldLock:
    """Espera até `timeout` segundos; levanta `TimeoutError` se não conseguir.

    Quem espera NÃO segura uma conexão do pool: cada tentativa pega uma, tenta o lock e, se não
    conseguiu, devolve a conexão antes de dormir. Assim, vários pedidos esperando o mesmo aluno não
    esgotam o pool e não travam os pedidos de outros alunos (só quem tem o lock ocupa conexão).
    """
    key = lock_key(name)
    async with asyncio.timeout(timeout):
        while True:
            connection = await (engine or lock_engine()).connect()
            try:
                connection = await connection.execution_options(
                    isolation_level="AUTOCOMMIT"
                )
                if await connection.scalar(
                    text("SELECT pg_try_advisory_lock(:k)"), {"k": key}
                ):
                    return HeldLock(connection, key)
            except BaseException:
                # Cancelado ou falho no meio: a conexão pode ter ficado com o lock; descarta-a.
                try:
                    await connection.invalidate()
                finally:
                    await connection.close()
                raise
            await connection.close()
            await asyncio.sleep(0.03 + random.random() * 0.05)
