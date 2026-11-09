"""Agendador interno: cada processo olha o relógio, mas só um ganha a concessão de cada execução."""

import asyncio
import logging
import secrets
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from api.db.context import use_context
from api.db.main import Database
from api.logger import event
from api.modules.sync import service, sources
from api.modules.sync.schedule import SOURCES, SyncSettings

Executor = Callable[[SyncSettings], Awaitable[service.Outcome]]
LEASE_MARGIN = timedelta(seconds=120)


class SyncScheduler:
    def __init__(
        self,
        sessionmaker: async_sessionmaker[AsyncSession],
        executors: dict[str, Executor] | None = None,
        tick_seconds: float = 30,
    ) -> None:
        self._database = Database(sessionmaker)
        self._sessionmaker = sessionmaker
        # Identifica este processo na concessão; aleatório, sem relação com pessoas.
        self.owner = secrets.token_hex(8)
        self._tick_seconds = tick_seconds
        self._loop_task: asyncio.Task[None] | None = None
        self._running: dict[str, asyncio.Task[None]] = {}
        self.executors: dict[str, Executor] = executors or {
            "catalog": lambda settings: sources.run_catalog(settings.timeout_seconds),
            "restaurant": lambda settings: sources.run_restaurant(
                self._sessionmaker, settings.timeout_seconds
            ),
        }

    async def start(self, tick_seconds: float | None = None) -> None:
        if tick_seconds is not None:
            self._tick_seconds = tick_seconds
        if self._loop_task is None:
            self._loop_task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        tasks = [*self._running.values()]
        if self._loop_task:
            tasks.append(self._loop_task)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self._running.clear()
        self._loop_task = None

    async def _loop(self) -> None:
        while True:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception as error:  # noqa: BLE001 — o agendador nunca derruba a API
                event(
                    "sync.tick_failed",
                    level=logging.WARNING,
                    error_type=type(error).__name__,
                )
            await asyncio.sleep(self._tick_seconds)

    async def tick(self) -> list[str]:
        """Dispara o que venceu; devolve as fontes que este processo começou a executar."""
        started: list[str] = []
        with use_context(scope="sync"):
            settings = await self._database.read(service.load_settings)
        for source in SOURCES:
            if not settings.enabled_for(source) or source in self._running:
                continue
            if await self._claim(source, settings, force=False):
                self._launch(source, settings, "schedule")
                started.append(source)
        return started

    async def _claim(self, source: str, settings: SyncSettings, *, force: bool) -> bool:
        now = datetime.now(UTC)
        lease = timedelta(seconds=settings.timeout_seconds) + LEASE_MARGIN

        async def operation(session: AsyncSession) -> bool:
            await service.ensure_state(
                session,
                source,
                now,
                settings,
                sources.legacy_last_update() if source == "catalog" else None,
            )
            return await service.claim(
                session, source, self.owner, now, lease, force=force
            )

        with use_context(scope="sync"):
            return await self._database.write(operation)

    def _launch(self, source: str, settings: SyncSettings, trigger: str) -> None:
        task = asyncio.create_task(self._execute(source, settings, trigger))
        self._running[source] = task
        task.add_done_callback(lambda _task: self._running.pop(source, None))

    async def _execute(self, source: str, settings: SyncSettings, trigger: str) -> None:
        started_at = datetime.now(UTC)
        event("sync.start", source=source, trigger=trigger)
        try:
            outcome = await self.executors[source](settings)
        except asyncio.CancelledError:
            raise
        except Exception as error:  # noqa: BLE001 — falha da fonte vira registro, não exceção
            outcome = service.Outcome(
                "failed", error=f"Erro interno: {type(error).__name__}"
            )

        async def record(session: AsyncSession) -> None:
            await service.finish(
                session, source, self.owner, trigger, started_at, outcome, settings
            )

        with use_context(scope="sync"):
            await self._database.write(record)
        event("sync.finish", source=source, trigger=trigger, status=outcome.status)

    async def trigger(self, source: str) -> str:
        """Execução manual em segundo plano. Devolve `started`, `busy` ou `cooldown`."""
        if source not in SOURCES:
            raise ValueError("Fonte desconhecida.")
        with use_context(scope="admin"):
            settings = await self._database.read(service.load_settings)
        if source in self._running:
            return "busy"
        now = datetime.now(UTC)

        async def cooling(session: AsyncSession) -> bool:
            state = await service.ensure_state(session, source, now, settings)
            last = state.last_attempt_at
            return last is not None and now - last < timedelta(
                seconds=settings.manual_cooldown_seconds
            )

        with use_context(scope="sync"):
            if await self._database.write(cooling):
                return "cooldown"
        if not await self._claim(source, settings, force=True):
            return "busy"
        self._launch(source, settings, "manual")
        return "started"

    def running(self) -> list[str]:
        return sorted(self._running)


_scheduler: SyncScheduler | None = None


def get_scheduler() -> SyncScheduler:
    global _scheduler
    if _scheduler is None:
        from api.db.main import async_session

        _scheduler = SyncScheduler(async_session)
    return _scheduler
