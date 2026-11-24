import httpx
import pytest
from fastapi import HTTPException

from api import http_pool, session_lock
from api.core.config import settings
from api.db.main import engine


def test_pool_segue_a_configuracao():
    pool = engine.pool
    assert pool.size() == settings.db_pool_size
    assert pool._max_overflow == settings.db_max_overflow
    assert pool._timeout == settings.db_pool_timeout_seconds
    assert pool._recycle == settings.db_pool_recycle_seconds


def test_limites_do_pool_sao_conservadores_por_padrao():
    assert settings.db_pool_size + settings.db_max_overflow <= 50
    assert 0 < settings.db_pool_timeout_seconds <= 60


async def test_pool_de_locks_suporta_pico_acima_do_tamanho_base():
    await session_lock.close()
    try:
        lock_pool = session_lock.lock_engine().pool
        assert lock_pool.size() == settings.session_lock_pool
        assert lock_pool._max_overflow == settings.session_lock_max_overflow
        assert settings.session_lock_max_overflow > 0
    finally:
        await session_lock.close()


async def test_pool_reserva_vaga_ate_fechar_corpo_da_resposta(monkeypatch):
    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b"teste"

    monkeypatch.setattr(settings, "sigaa_max_concurrent_requests", 1)
    monkeypatch.setattr(settings, "sigaa_queue_timeout_seconds", 0.01)
    await http_pool.close()
    pool = http_pool._current_pool()
    await pool.transport.aclose()
    pool.transport = httpx.MockTransport(lambda _: httpx.Response(200, stream=Stream()))
    transport = http_pool.borrowed_transport()
    request = httpx.Request("GET", "https://example.test")
    try:
        response = await transport.handle_async_request(request)
        try:
            assert http_pool.pool_status()["active_requests"] == 1
            with pytest.raises(HTTPException) as error:
                await transport.handle_async_request(request)
            assert error.value.status_code == 503
        finally:
            await response.aclose()
        assert http_pool.pool_status()["active_requests"] == 0
        retry = await transport.handle_async_request(request)
        await retry.aclose()
    finally:
        await http_pool.close()
