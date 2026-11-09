"""Cotas sensíveis compartilhadas entre workers (Postgres), sem Redis."""

import asyncio

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from api import rate_limit
from api.core.config import settings


@pytest.fixture
def compartilhado(database, monkeypatch):
    url = database.kw["bind"].url.set(drivername="postgresql+asyncpg")
    engines = [create_async_engine(url, poolclass=NullPool) for _ in range(3)]
    sessions = [async_sessionmaker(e, expire_on_commit=False) for e in engines]
    with database.begin() as session:
        session.execute(text("DELETE FROM rate_windows"))
    monkeypatch.setattr(settings, "rate_limit_backend", "postgres")
    from api.db import main

    state = {"i": 0}

    class Alternando:
        """Cada chamada usa uma conexão/engine diferente, como se fossem workers distintos."""

        def begin(self):
            state["i"] += 1
            return sessions[state["i"] % 3].begin()

    monkeypatch.setattr(main, "async_session", Alternando())
    yield
    for engine in engines:
        engine.sync_engine.dispose()


async def permitidos(n, limit=10, key="1.2.3.4"):
    results = await asyncio.gather(
        *[rate_limit._limit("teste", key, limit, 60, shared=True) for _ in range(n)]
    )
    return sum(r.allowed for r in results)


async def test_contagem_atomica_entre_conexoes_concorrentes(compartilhado):
    assert await permitidos(40) == 10


async def test_cota_nao_reinicia_ao_cair_em_outro_worker(compartilhado):
    assert await permitidos(10) == 10
    rate_limit.reset_memory()  # outro processo: a memória local dele está vazia
    assert await permitidos(5) == 0
    rate_limit.reset_memory()
    assert await permitidos(5, key="outro-ip") == 5  # outro bucket não é afetado


async def test_janela_nova_zera_a_contagem(compartilhado, monkeypatch):
    base = 1_800_000_000
    monkeypatch.setattr(rate_limit, "time", lambda: base)
    assert await permitidos(10) == 10 and await permitidos(1) == 0
    rate_limit.reset_memory()
    monkeypatch.setattr(rate_limit, "time", lambda: base + 61)
    assert await permitidos(3) == 3


async def test_o_bucket_gravado_nao_contem_o_endereco(compartilhado, database):
    await permitidos(1, key="203.0.113.77")
    with database() as session:
        buckets = [
            b for (b,) in session.execute(text("SELECT bucket FROM rate_windows"))
        ]
    assert buckets and all("203.0.113.77" not in b for b in buckets)


async def test_banco_fora_cai_na_cota_local(compartilhado, monkeypatch):
    from api.db import main

    class Quebrado:
        def begin(self):
            raise ConnectionError("banco fora")

    monkeypatch.setattr(main, "async_session", Quebrado())
    assert (
        await permitidos(25, limit=10, key="sem-banco") == 10
    )  # a memória local ainda segura


async def test_sem_o_backend_postgres_nada_e_gravado(database, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_backend", "memory")
    with database.begin() as session:
        session.execute(text("DELETE FROM rate_windows"))
    assert await permitidos(3, key="local") == 3
    with database() as session:
        assert (
            session.execute(text("SELECT count(*) FROM rate_windows")).scalar_one() == 0
        )
