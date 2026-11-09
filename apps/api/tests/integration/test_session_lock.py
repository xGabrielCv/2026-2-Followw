"""Bloqueio da sessão SIGAA entre workers (advisory lock do PostgreSQL)."""

import asyncio
import time

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from api import session_lock
from api.core.config import settings


@pytest.fixture
def motores(database):
    """Dois engines = duas conexões independentes, como dois workers."""
    url = database.kw["bind"].url.set(drivername="postgresql+asyncpg")
    engines = [create_async_engine(url, poolclass=NullPool) for _ in range(2)]
    yield engines
    for engine in engines:
        engine.sync_engine.dispose()


async def test_so_um_worker_por_vez_na_mesma_sessao(motores):
    a, b = motores
    primeiro = await session_lock.acquire("sessao-ana", 1, engine=a)
    with pytest.raises(TimeoutError):
        await session_lock.acquire("sessao-ana", 0.2, engine=b)
    await primeiro.release()
    segundo = await session_lock.acquire(
        "sessao-ana", 1, engine=b
    )  # liberou: o outro entra
    await segundo.release()


async def test_sessoes_diferentes_nao_se_bloqueiam(motores):
    a, b = motores
    ana = await session_lock.acquire("ana", 1, engine=a)
    bia = await session_lock.acquire("bia", 1, engine=b)
    await asyncio.gather(ana.release(), bia.release())


async def test_espera_e_entra_quando_o_outro_solta(motores):
    a, b = motores
    primeiro = await session_lock.acquire("fila", 1, engine=a)
    espera = asyncio.create_task(session_lock.acquire("fila", 3, engine=b))
    await asyncio.sleep(0.2)
    assert not espera.done()
    await primeiro.release()
    segundo = await asyncio.wait_for(espera, 2)
    await segundo.release()


async def test_conexao_que_cai_solta_o_lock_sozinha(motores):
    """Processo morto = conexão fechada: o PostgreSQL solta o lock (sem lock órfão)."""
    a, b = motores
    preso = await session_lock.acquire("morre", 1, engine=a)
    await preso._connection.invalidate()  # derruba a conexão sem soltar o lock
    outro = await session_lock.acquire("morre", 2, engine=b)
    await outro.release()


async def test_cada_chave_exclusiva_n_concorrentes(motores):
    a, b = motores
    dentro = maximo = 0

    async def trabalhar(engine):
        nonlocal dentro, maximo
        held = await session_lock.acquire("secao-critica", 5, engine=engine)
        dentro += 1
        maximo = max(maximo, dentro)
        await asyncio.sleep(0.02)
        dentro -= 1
        await held.release()

    await asyncio.gather(*[trabalhar(a if i % 2 else b) for i in range(12)])
    assert maximo == 1


def test_a_chave_nao_expoe_a_matricula():
    k = session_lock.lock_key("251000000")
    assert isinstance(k, int) and -(2**63) <= k < 2**63
    assert "251000000" not in str(k) and k != session_lock.lock_key("251000001")
    assert settings.session_lock_backend == "memory"  # padrão de desenvolvimento


async def test_nenhum_lock_fica_preso_no_banco_depois(motores, database):
    a, _ = motores
    held = await session_lock.acquire("limpo", 1, engine=a)
    await held.release()
    await asyncio.sleep(0.1)
    with database() as session:
        locks = session.execute(
            text("SELECT count(*) FROM pg_locks WHERE locktype = 'advisory'")
        ).scalar_one()
    assert locks == 0


async def test_tempo_limite_inclui_espera_por_conexao_no_pool(database):
    url = database.kw["bind"].url.set(drivername="postgresql+asyncpg")
    engine = create_async_engine(url, pool_size=1, max_overflow=0, pool_timeout=30)
    held = await session_lock.acquire("primeiro", 1, engine=engine)
    started = time.monotonic()
    try:
        with pytest.raises(TimeoutError):
            await session_lock.acquire("outra-sessao", 0.05, engine=engine)
        assert time.monotonic() - started < 0.5
    finally:
        await held.release()
        await engine.dispose()


async def test_cancelamento_de_unlock_descarta_conexao_e_libera_lock(
    motores, database, monkeypatch
):
    first = create_async_engine(
        database.kw["bind"].url.set(drivername="postgresql+asyncpg"),
        pool_size=1,
        max_overflow=0,
    )
    _, second = motores
    try:
        held = await session_lock.acquire("cancelar-liberacao", 1, engine=first)

        async def cancelled(*args, **kwargs):
            raise asyncio.CancelledError

        with monkeypatch.context() as patch:
            patch.setattr(type(held._connection), "execute", cancelled)
            with pytest.raises(asyncio.CancelledError):
                await held.release()
        recovered = await session_lock.acquire("cancelar-liberacao", 1, engine=second)
        await recovered.release()
    finally:
        await first.dispose()


async def test_cancelamento_apos_pg_adquirir_lock_nao_devolve_conexao_presa_ao_pool(
    motores, database, monkeypatch
):
    from sqlalchemy.ext.asyncio import AsyncConnection

    first = create_async_engine(
        database.kw["bind"].url.set(drivername="postgresql+asyncpg"),
        pool_size=1,
        max_overflow=0,
    )
    _, second = motores
    original = AsyncConnection.scalar

    async def interrupted(connection, *args, **kwargs):
        await original(connection, *args, **kwargs)
        raise asyncio.CancelledError

    try:
        with monkeypatch.context() as patch:
            patch.setattr(AsyncConnection, "scalar", interrupted)
            with pytest.raises(asyncio.CancelledError):
                await session_lock.acquire("cancelar-aquisicao", 1, engine=first)
        recovered = await session_lock.acquire("cancelar-aquisicao", 1, engine=second)
        await recovered.release()
    finally:
        await first.dispose()
