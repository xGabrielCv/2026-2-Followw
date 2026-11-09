"""Grava no banco, em segundo plano, só os eventos técnicos que a administração precisa investigar."""

import asyncio
import logging
import math
import re
from collections import deque
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from api import logger
from api.db.context import use_context
from api.db.main import Database
from api.modules.logs.models import AppEvent

# Nome de campo que nunca é gravado, mesmo que o logger o deixasse passar.
SENSITIVE = re.compile(
    r"pass|token|secret|cookie|registration|matricula|authorization|key|email|cpf|body|payload|url",
    re.IGNORECASE,
)
PREFIXES = ("sync.", "admin.", "security.")
MAX_VALUE = 120
BATCH = 200
NUMERIC_FIELDS = frozenset(
    {
        "status_code",
        "duration_ms",
        "attempt",
        "step_count",
        "job_count",
        "failed_count",
        "skipped_count",
        "course_count",
        "error_line",
    }
)
TEXT_FIELDS = {
    "route": r"/[A-Za-z_/{}/-]{0,119}",
    "method": r"GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS",
    "error_type": r"[A-Za-z_][A-Za-z_0-9]{0,79}",
    "error_file": r"[A-Za-z_][A-Za-z_0-9]*\.py",
    "error_function": r"[A-Za-z_][A-Za-z_0-9]{0,79}",
    "source": r"catalog|restaurant",
    "trigger": r"manual|schedule",
    "outcome": r"success|unchanged|failed|skipped|cancelled",
    "task": r"[a-z_][a-z_.]{0,79}",
}


def wanted(level: int, name: str, fields: dict) -> bool:
    """Avisos e erros, a sincronização e respostas 5xx; o fluxo normal de pedidos fica de fora."""
    if level >= logging.WARNING or name.startswith(PREFIXES):
        return True
    status = fields.get("status_code")
    return name == "request.completed" and isinstance(status, int) and status >= 500


def clean(fields: dict) -> dict:
    result = {}
    for key, value in fields.items():
        if (
            (
                key in NUMERIC_FIELDS
                and type(value) in (int, float)
                and math.isfinite(value)
                and 0 <= value <= 1e12
            )
            or key == "reused_session"
            and type(value) is bool
            or (
                key in TEXT_FIELDS
                and isinstance(value, str)
                and len(value) <= MAX_VALUE
                and re.fullmatch(TEXT_FIELDS[key], value)
            )
        ):
            result[key] = value
    return result


class EventSink:
    def __init__(
        self,
        sessionmaker: async_sessionmaker[AsyncSession],
        *,
        retention_days: int = 14,
        flush_seconds: float = 2,
        max_queue: int = 2000,
    ) -> None:
        self._database = Database(sessionmaker)
        self._queue: deque[AppEvent] = deque(maxlen=max_queue)
        self._flush_seconds = flush_seconds
        self.retention = timedelta(days=retention_days)
        self.dropped = 0
        self._task: asyncio.Task[None] | None = None

    def offer(self, level: int, name: str, fields: dict) -> None:
        """Chamado a cada evento: só enfileira (sem rede, sem espera, sem exceção)."""
        try:
            if not wanted(level, name, fields):
                return
            if len(self._queue) == self._queue.maxlen:
                self.dropped += 1
            self._queue.append(
                AppEvent(
                    at=datetime.now(UTC),
                    level=logging.getLevelName(level),
                    event=name[:80],
                    fields=clean(fields),
                )
            )
        except Exception:  # noqa: BLE001 — registrar nunca pode quebrar o pedido
            self.dropped += 1

    async def flush(self) -> int:
        batch: list[AppEvent] = []
        while self._queue and len(batch) < BATCH:
            batch.append(self._queue.popleft())
        if not batch:
            return 0

        async def write(session: AsyncSession) -> None:
            session.add_all(batch)

        try:
            with use_context(scope="logs"):
                await self._database.write(write)
        except Exception:  # noqa: BLE001 — sem registrar o erro: evitaria um laço de eventos
            self.dropped += len(batch)
            return 0
        return len(batch)

    async def purge(self) -> None:
        cutoff = datetime.now(UTC) - self.retention

        async def write(session: AsyncSession) -> None:
            await session.execute(delete(AppEvent).where(AppEvent.at < cutoff))

        try:
            with use_context(scope="logs"):
                await self._database.write(write)
        except Exception:  # noqa: BLE001, S110 — a limpeza tenta de novo na próxima hora
            pass

    async def _loop(self) -> None:
        ticks = 0
        while True:
            await asyncio.sleep(self._flush_seconds)
            await self.flush()
            ticks += 1
            if ticks % max(int(3600 / self._flush_seconds), 1) == 1:
                await self.purge()

    async def start(self) -> None:
        if self._task is None:
            logger.set_sink(self.offer)
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        logger.set_sink(None)
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None
        await self.flush()


_sink: EventSink | None = None


def get_sink() -> EventSink:
    global _sink
    if _sink is None:
        from api.core.config import settings
        from api.db.main import async_session

        _sink = EventSink(async_session, retention_days=settings.log_retention_days)
    return _sink
