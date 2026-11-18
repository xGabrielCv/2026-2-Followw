from api import session_lock
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
