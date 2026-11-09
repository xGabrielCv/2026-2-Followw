from time import perf_counter

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.seed.classrooms import seed_classrooms
from api.db.seed.courses import seed_courses
from api.db.seed.curricula import seed_curricula
from api.db.seed.subjects import seed_subjects
from api.db.seed.units import seed_units


async def seed_database(session: AsyncSession) -> None:
    """Grava os dados de referência; a ordem importa."""
    await seed_units(session)
    await seed_courses(session)
    await seed_curricula(session)
    await seed_subjects(session)
    await seed_classrooms(session)


async def sync_catalog(professors: str | None = None) -> dict[str, int]:
    """Carga transacional sob o papel da aplicação: sem DDL, TRUNCATE ou remoção de catálogo."""
    from pathlib import Path

    from api.db.context import use_context
    from api.db.main import Database, async_session, engine
    from api.db.seed.professors import seed_professors

    async def write(session):
        started = perf_counter()
        before, sizes_before = await catalog_snapshot(session)
        await seed_database(session)
        if professors:
            await seed_professors(session, Path(professors))
        after, sizes_after = await catalog_snapshot(session)
        old_keys, new_keys = before.keys(), after.keys()
        return {
            "before": len(before),
            "after": len(after),
            "inserted": len(new_keys - old_keys),
            "changed": sum(before[key] != after[key] for key in old_keys & new_keys),
            "unchanged": sum(before[key] == after[key] for key in old_keys & new_keys),
            "inactivated": sum(
                before[key][1] and not after[key][1] for key in old_keys & new_keys
            ),
            "removed": len(old_keys - new_keys),
            "database_bytes_before": sizes_before[0],
            "database_bytes_after": sizes_after[0],
            "index_bytes_before": sizes_before[1],
            "index_bytes_after": sizes_after[1],
            "duration_ms": round((perf_counter() - started) * 1000),
        }

    try:
        with use_context(scope="sync"):
            return await Database(async_session).write(write)
    finally:
        await engine.dispose()


async def catalog_snapshot(
    session: AsyncSession,
) -> tuple[dict[str, tuple[str, bool]], tuple[int, int]]:
    """Compara somente tabelas institucionais públicas; guarda os resumos em memória nesta carga."""
    from api.db.base import Base

    rows = {}
    tables = (
        "units",
        "courses",
        "curricula",
        "curriculum_components",
        "subjects",
        "professors",
        "classrooms",
        "classroom_professors",
    )
    for name in tables:
        keys = [column.name for column in Base.metadata.tables[name].primary_key]
        identity = " || ':' || ".join(f"t.{key}::text" for key in keys)
        result = await session.execute(
            text(
                f"SELECT {identity}, md5((to_jsonb(t) - 'created_at' - 'updated_at')::text), COALESCE((to_jsonb(t)->>'offer_active')::boolean, (to_jsonb(t)->>'active')::boolean, true) FROM {name} t"
            )
        )
        rows.update(
            (f"{name}:{key}", (digest, active)) for key, digest, active in result
        )
    sizes = (
        await session.execute(
            text(
                "SELECT pg_database_size(current_database()), COALESCE(sum(pg_indexes_size(relid)), 0) FROM pg_stat_user_tables"
            )
        )
    ).one()
    return rows, (int(sizes[0]), int(sizes[1]))
