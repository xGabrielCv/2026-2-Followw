"""Estado das proteções de origem e do pool de conexões, sem nenhum dado de aluno."""

from api import resilience
from api.db.main import engine


def _origin_view(guard, counters: dict[str, int]) -> dict:
    name = guard.name
    return {
        "circuit": guard.breaker.state,
        "origin_calls": counters.get(f"origin.{name}.calls", 0),
        "shared_requests": counters.get("single_flight.shared", 0),
        "stale_served": counters.get(
            f"origin.{name}.stale_served", counters.get("cache.stale_served", 0)
        ),
        "circuit_rejections": counters.get(f"breaker.{name}.rejected", 0),
        "circuit_opened": counters.get(f"breaker.{name}.opened", 0),
    }


def origin_guards() -> dict[str, resilience.OriginGuard]:
    from api.modules.public_classrooms.service import CLASSROOMS_ORIGIN, UNITS_ORIGIN
    from api.modules.public_restaurant.service import RESTAURANT_ORIGIN

    return {
        "ru": RESTAURANT_ORIGIN,
        "sigaa_units": UNITS_ORIGIN,
        "sigaa_classrooms": CLASSROOMS_ORIGIN,
    }


def resilience_status() -> dict:
    counters = resilience.counters()
    guards = origin_guards()
    return {
        **{name: _origin_view(guard, counters) for name, guard in guards.items()},
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
