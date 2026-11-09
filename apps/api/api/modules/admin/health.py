"""Estado das proteções de origem e do pool de conexões, sem nenhum dado de aluno."""

from api import resilience
from api.db.main import engine


def resilience_status() -> dict:
    from api.modules.public_restaurant.service import RESTAURANT_ORIGIN

    counters = resilience.counters()
    calls = counters.get("origin.ru.calls", 0)
    shared = counters.get("single_flight.shared", 0)
    return {
        "ru": {
            "circuit": RESTAURANT_ORIGIN.breaker.state,
            "origin_calls": calls,
            "shared_requests": shared,
            "stale_served": counters.get("origin.ru.stale_served", 0),
            "circuit_rejections": counters.get("breaker.ru.rejected", 0),
        },
        "counters": counters,
    }


def pool_status() -> dict:
    pool = engine.pool
    try:
        return {
            "size": pool.size(),
            "in_use": pool.checkedout(),
            "idle": pool.checkedin(),
            "overflow": pool.overflow(),
        }
    except AttributeError:  # pool sem esses contadores (ex.: NullPool nos testes)
        return {}
