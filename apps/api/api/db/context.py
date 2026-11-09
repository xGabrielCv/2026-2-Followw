"""Contexto de autorização da requisição, entregue ao PostgreSQL só dentro da transação.

Quem decide o contexto é o backend, depois de validar a sessão administrativa ou a chave do chamado;
nada aqui vem pronto do navegador. O valor vai com `set_config(..., true)` (equivale a `SET LOCAL`):
termina junto com a transação, então a conexão devolvida ao pool nunca carrega o contexto adiante.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Lista fechada: o nome do parâmetro entra no SQL, então nunca vem de fora.
KEYS = (
    "scope",
    "ticket_hash",
    "recovery_hash",
    "author_key",
    "legacy_author_key",
    "community_operation",
    "material_subject",
    "oldest_semester",
    "forum_post",
    "reply_limit",
    "group_subject",
    "group_semester",
    "group_number",
    "review_hash",
    "review_id",
    "material_id",
    "report_target",
    "share_keys",
)
_context: ContextVar[dict[str, str] | None] = ContextVar(
    "followw_db_context", default=None
)


def current() -> dict[str, str]:
    return _context.get() or {}


def set_context(**values: str) -> None:
    """Vale até o fim da requisição (cada requisição roda na própria cópia do contexto)."""
    _validate(values)
    _context.set({**current(), **values})


@contextmanager
def use_context(**values: str) -> Iterator[None]:
    _validate(values)
    token = _context.set({**current(), **values})
    try:
        yield
    finally:
        _context.reset(token)


def _validate(values: dict[str, str]) -> None:
    unknown = set(values) - set(KEYS)
    if unknown:
        raise ValueError(f"Contexto desconhecido: {sorted(unknown)}")


async def apply_context(session: AsyncSession) -> None:
    """Primeiro comando da transação; sem contexto, não faz nada (as políticas negam por padrão)."""
    values = current()
    if not values:
        return
    keys = sorted(values)
    statement = "SELECT " + ", ".join(
        f"set_config('app.{key}', :{key}, true)" for key in keys
    )
    await session.execute(text(statement), {key: values[key] for key in keys})
