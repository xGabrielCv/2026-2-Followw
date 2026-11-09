"""Estado, concessão e histórico da sincronização; toda gravação é atômica no PostgreSQL."""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from pydantic import ValidationError
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import SystemText
from api.modules.sync.models import SyncRun, SyncState
from api.modules.sync.schedule import KEY, SyncSettings, backoff, next_run

Status = str  # success | unchanged | failed | skipped


@dataclass(frozen=True)
class Outcome:
    status: Status
    records: int | None = None
    content_hash: str | None = None
    error: str | None = None
    metrics: dict[str, int] = field(default_factory=dict)


async def load_settings(session: AsyncSession) -> SyncSettings:
    row = await session.get(SystemText, KEY)
    if row is None:
        return SyncSettings()
    try:
        return SyncSettings.model_validate_json(row.value)
    except ValidationError:
        # Valor adulterado ou antigo: volta ao padrão seguro em vez de parar a sincronização.
        return SyncSettings()


async def save_settings(session: AsyncSession, value: SyncSettings) -> None:
    row = await session.get(SystemText, KEY)
    if row is None:
        session.add(SystemText(key=KEY, value=value.model_dump_json()))
    else:
        row.value = value.model_dump_json()


def first_run(
    state: SyncState | None,
    now: datetime,
    settings: SyncSettings,
    times: list[str],
    legacy_last: datetime | None = None,
) -> datetime:
    """Na subida: executa já só se nunca teve sucesso ou se o último é mais velho que o limite."""
    last = (state.last_success_at if state else None) or legacy_last
    if last is None or now - last > timedelta(hours=settings.startup_max_age_hours):
        return now
    return next_run(now, times)


async def ensure_state(
    session: AsyncSession,
    source: str,
    now: datetime,
    settings: SyncSettings,
    legacy_last: datetime | None = None,
) -> SyncState:
    await session.execute(
        insert(SyncState)
        .values(source=source, consecutive_failures=0)
        .on_conflict_do_nothing(index_elements=["source"])
    )
    state = await session.get(SyncState, source, populate_existing=True)
    assert state is not None
    if state.next_run_at is None:
        # `WHERE next_run_at IS NULL` deixa só um processo decidir o primeiro horário.
        await session.execute(
            update(SyncState)
            .where(SyncState.source == source, SyncState.next_run_at.is_(None))
            .values(
                next_run_at=first_run(
                    state, now, settings, settings.times_for(source), legacy_last
                )
            )
        )
        state = await session.get(SyncState, source, populate_existing=True)
        assert state is not None
    return state


async def claim(
    session: AsyncSession,
    source: str,
    owner: str,
    now: datetime,
    lease: timedelta,
    *,
    force: bool,
    resource: str = "all",
) -> bool:
    """Um único processo ganha: o UPDATE condicional é o que decide, não uma leitura anterior."""
    conditions = [
        SyncState.source == source,
        (SyncState.lease_until.is_(None)) | (SyncState.lease_until < now),
    ]
    if not force:
        conditions.append(SyncState.next_run_at <= now)
    result = await session.execute(
        update(SyncState)
        .where(*conditions)
        .values(
            lease_until=now + lease,
            lease_owner=owner,
            last_attempt_at=now,
            cancel_requested=False,
        )
        .returning(SyncState.source)
    )
    won = result.first() is not None
    if won:
        await session.execute(
            update(SyncRun)
            .where(SyncRun.source == source, SyncRun.status == "running")
            .values(
                status="failed",
                finished_at=now,
                error="Concessão expirada; execução anterior interrompida.",
            )
        )
        session.add(
            SyncRun(
                id=uuid.uuid4(),
                source=source,
                trigger="manual" if force else "schedule",
                status="running",
                started_at=now,
                changed=False,
                owner=owner,
                resource=resource,
            )
        )
    return won


async def finish(
    session: AsyncSession,
    source: str,
    owner: str,
    trigger: str,
    started_at: datetime,
    outcome: Outcome,
    settings: SyncSettings,
) -> None:
    now = datetime.now(UTC)
    state = await session.get(SyncState, source, populate_existing=True)
    assert state is not None
    # A concessão pode ter vencido e passado a outro processo: não sobrescreve o dele.
    mine = state.lease_owner == owner
    changed = (
        outcome.status == "success"
        and outcome.content_hash is not None
        and outcome.content_hash != state.content_hash
    )
    if (
        outcome.status == "success"
        and {"inserted", "changed", "removed"} <= outcome.metrics.keys()
    ):
        changed = any(
            outcome.metrics[key] for key in ("inserted", "changed", "removed")
        )
    status = outcome.status
    if outcome.status == "success" and not changed:
        status = "unchanged"
    run = await session.scalar(
        select(SyncRun)
        .where(
            SyncRun.source == source,
            SyncRun.owner == owner,
            SyncRun.status == "running",
        )
        .order_by(SyncRun.started_at.desc())
        .limit(1)
    )
    if run is None:
        run = SyncRun(
            id=uuid.uuid4(),
            source=source,
            trigger=trigger,
            started_at=started_at,
            owner=owner,
        )
        session.add(run)
    run.status, run.finished_at, run.changed, run.records, run.error = (
        status,
        now,
        changed,
        outcome.records,
        outcome.error,
    )
    run.metrics = outcome.metrics
    if mine:
        times = settings.times_for(source)
        state.lease_until = None
        state.lease_owner = None
        state.cancel_requested = False
        state.last_status = status
        if status in {"success", "unchanged"}:
            state.last_success_at = now
            state.consecutive_failures = 0
            state.records = outcome.records
            if outcome.content_hash is not None:
                state.content_hash = outcome.content_hash
            if changed:
                state.last_change_at = now
                state.content_hash = outcome.content_hash
            # Manual não adianta o horário seguinte, mas não deixa um vencimento antigo repetir a rodada.
            overdue = state.next_run_at is None or state.next_run_at <= now
            if trigger != "manual" or overdue:
                state.next_run_at = next_run(now, times)
        elif status == "failed" and trigger != "manual":
            # Falha mantém o último dado válido e tenta de novo com espera crescente.
            state.consecutive_failures += 1
            state.next_run_at = min(
                next_run(now, times),
                now + backoff(state.consecutive_failures, settings),
            )
        elif status in {"skipped", "cancelled"}:
            state.next_run_at = next_run(now, times)
    await session.flush()
    # Só as últimas execuções ficam (sem texto livre ou dados pessoais).
    keep = (
        select(SyncRun.id)
        .where(SyncRun.source == source)
        .order_by(SyncRun.started_at.desc())
        .limit(settings.history_limit)
    )
    await session.execute(
        delete(SyncRun).where(SyncRun.source == source, SyncRun.id.not_in(keep))
    )


async def reschedule(
    session: AsyncSession, settings: SyncSettings, source: str
) -> None:
    """Depois de mudar horários ou ligar/desligar: o próximo horário segue a nova regra."""
    now = datetime.now(UTC)
    await session.execute(
        update(SyncState)
        .where(SyncState.source == source)
        .values(next_run_at=next_run(now, settings.times_for(source)))
    )
