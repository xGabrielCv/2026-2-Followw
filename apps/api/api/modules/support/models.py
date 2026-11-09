"""Chamados de suporte anônimos: sem matrícula, nome, e-mail ou sessão do SIGAA."""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Identity, Index
from sqlalchemy.orm import Mapped, mapped_column

from api.crypto import Encrypted
from api.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Ticket(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "tickets"
    __table_args__ = (
        Index("ix_tickets_queue", "status", "priority", "updated_at"),
        Index("ix_tickets_author", "author_key", "status"),
        Index("uq_tickets_appeal_digest", "appeal_digest", unique=True),
    )

    # Número mostrado ao aluno; o acesso nunca depende dele.
    number: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    # Só verificadores (HMAC) dos segredos: o servidor não consegue reconstruí-los.
    secret_hash: Mapped[str] = mapped_column()
    recovery_hash: Mapped[str | None] = mapped_column()
    # Legado: já foi uma chave por aparelho. Hoje fica sempre nulo; as antigas são zeradas na migração.
    author_key: Mapped[str | None] = mapped_column()
    category: Mapped[str] = mapped_column()
    title: Mapped[str] = mapped_column(Encrypted("support.title"))
    # open, in_review, waiting_student, answered, resolved ou closed.
    status: Mapped[str] = mapped_column(default="open")
    priority: Mapped[str] = mapped_column(default="normal")
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("admin_accounts.id", ondelete="SET NULL")
    )
    related_type: Mapped[str | None] = mapped_column()
    related_id: Mapped[uuid.UUID | None] = mapped_column()
    appeal_decision_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("admin_log.id")
    )
    appeal_author_proven: Mapped[bool] = mapped_column(
        default=False, server_default="false"
    )
    appeal_outcome: Mapped[str | None] = mapped_column()
    appeal_digest: Mapped[str | None] = mapped_column()
    message_count: Mapped[int] = mapped_column(default=0)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # student ou staff: quem encerrou, para saber se o aluno pode reabrir.
    closed_by: Mapped[str | None] = mapped_column()


class TicketMessage(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "ticket_messages"

    ticket_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tickets.id", ondelete="CASCADE"), index=True
    )
    # student, staff ou note (nota interna: o aluno nunca recebe).
    sender: Mapped[str] = mapped_column()
    body: Mapped[str] = mapped_column(Encrypted("support.message"))
    admin_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("admin_accounts.id", ondelete="SET NULL")
    )
