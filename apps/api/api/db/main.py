import asyncio
from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import Depends
from sqlalchemy import Connection, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api.core.config import settings
from api.db import models  # noqa: F401 — registra os modelos em Base.metadata
from api.db.base import Base
from api.db.context import apply_context
from api.db.security import secure
from api.db.seed.run import seed_database
from api.db.updates import apply_updates
from api.logger import event

# A instância da Vercel congela entre requisições: a conexão parada pode ter caído.
engine = create_async_engine(
    settings.database_url,
    pool_pre_ping=True,
    hide_parameters=True,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_timeout=settings.db_pool_timeout_seconds,
    pool_recycle=settings.db_pool_recycle_seconds,
    connect_args={
        "server_settings": {"statement_timeout": str(settings.db_statement_timeout_ms)}
    },
)

async_session = async_sessionmaker(engine, expire_on_commit=False)

# Manutenção (esquema, políticas, carga do catálogo): conta própria quando configurada.
maintenance_engine = (
    create_async_engine(settings.database_maintenance_url, hide_parameters=True)
    if settings.database_maintenance_url
    else engine
)
maintenance_session = async_sessionmaker(maintenance_engine, expire_on_commit=False)

_WRITE_ATTEMPTS = 3


def after_commit(session: AsyncSession, action: Callable[[], Awaitable[None]]) -> None:
    """Efeitos externos só depois da confirmação da transação, nunca durante uma tentativa."""
    session.info.setdefault("after_commit", []).append(action)


def after_rollback(
    session: AsyncSession, action: Callable[[], Awaitable[None]]
) -> None:
    """Compensa somente recursos externos criados pela tentativa que não confirmou."""
    session.info.setdefault("after_rollback", []).append(action)


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    return async_session


SessionmakerDep = Annotated[async_sessionmaker[AsyncSession], Depends(get_sessionmaker)]


class Database:
    """Cada leitura e cada gravação numa sessão própria do banco."""

    def __init__(self, sessionmaker: async_sessionmaker[AsyncSession]) -> None:
        self._sessionmaker = sessionmaker

    async def read[T](self, query: Callable[[AsyncSession], Awaitable[T]]) -> T:
        async with self._sessionmaker() as session:
            await apply_context(session)
            return await query(session)

    async def write[T](self, write: Callable[[AsyncSession], Awaitable[T]]) -> T:
        # Outra requisição pode criar as mesmas linhas ao mesmo tempo: na tentativa
        # seguinte elas já existem e viram update.
        attempt = 1
        while True:
            try:
                async with self._sessionmaker() as session:
                    committing = False
                    try:
                        await apply_context(session)
                        result = await write(session)
                        committing = True
                        await session.commit()
                    except BaseException as failure:
                        await session.rollback()
                        actions = session.info.pop("after_rollback", [])
                        # Perda de conexão durante COMMIT tem resultado incerto: preservar arquivos é mais seguro.
                        if committing and not isinstance(failure, IntegrityError):
                            actions = []
                            event(
                                "storage.cleanup_deferred",
                                level=30,
                                error_type=type(failure).__name__,
                            )
                        for action in actions:
                            try:
                                await asyncio.shield(action())
                            except Exception as error:  # noqa: BLE001 — compensação não substitui a falha original
                                event(
                                    "storage.cleanup_failed",
                                    error_type=type(error).__name__,
                                )
                        raise
                    session.info.pop("after_rollback", None)
                    for action in session.info.pop("after_commit", []):
                        try:
                            await action()
                        except Exception as error:  # noqa: BLE001 — limpeza não desfaz um commit já confirmado
                            # Uma falha de limpeza deixa um órfão cifrado, sem desfazer conteúdo confirmado.
                            event(
                                "storage.cleanup_failed",
                                error_type=type(error).__name__,
                            )
                    return result
            except IntegrityError:
                if attempt == _WRITE_ATTEMPTS:
                    raise
                attempt += 1


def get_database(sessionmaker: SessionmakerDep) -> Database:
    return Database(sessionmaker)


DatabaseDep = Annotated[Database, Depends(get_database)]


def create_schema(conn: Connection) -> None:
    conn.execute(text("SELECT pg_advisory_xact_lock(865942117)"))
    Base.metadata.create_all(conn)
    apply_updates(conn)
    # O `create_all` só cria os índices junto de uma tabela nova.
    for table in Base.metadata.sorted_tables:
        for index in table.indexes:
            index.create(conn, checkfirst=True)
    secure(conn, settings.app_db_password, role=settings.app_db_role)


async def create_tables() -> None:
    await update_schema()
    async with maintenance_session.begin() as session:
        await seed_database(session)


async def update_schema() -> None:
    """Atualiza esquema e políticas sem coletar fontes nem recarregar o catálogo."""
    async with maintenance_engine.begin() as conn:
        await conn.run_sync(create_schema)


def db_init() -> None:
    asyncio.run(create_tables())
