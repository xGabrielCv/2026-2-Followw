"""Bloqueio da sessão SIGAA entre workers (advisory lock do PostgreSQL)."""

import asyncio

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
