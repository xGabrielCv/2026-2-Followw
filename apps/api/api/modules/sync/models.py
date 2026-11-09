from datetime import datetime

from sqlalchemy import DateTime, Index, Integer
from sqlalchemy.orm import Mapped, mapped_column

from api.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class SyncState(Base, TimestampMixin):
    """Estado de uma fonte pública: só datas, contagens e o resumo (hash) do conteúdo; nada pessoal."""

    __tablename__ = "sync_state"

    source: Mapped[str] = mapped_column(primary_key=True)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_change_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Concessão: só quem a pegou executa, e ela vence sozinha se o processo morrer no meio.
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lease_owner: Mapped[str | None] = mapped_column()
    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0)
    last_status: Mapped[str | None] = mapped_column()
    records: Mapped[int | None] = mapped_column(Integer)
    content_hash: Mapped[str | None] = mapped_column()


class SyncRun(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Histórico de execuções; o erro guardado é um resumo curto e sem segredos."""

    __tablename__ = "sync_runs"
    __table_args__ = (Index("ix_sync_runs_source_started", "source", "started_at"),)

    source: Mapped[str] = mapped_column()
    trigger: Mapped[str] = mapped_column()
    status: Mapped[str] = mapped_column()
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    changed: Mapped[bool] = mapped_column(default=False)
    records: Mapped[int | None] = mapped_column(Integer)
    error: Mapped[str | None] = mapped_column()
