from datetime import datetime
from uuid import UUID

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from api.crypto import Encrypted
from api.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class AdminAccount(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "admin_accounts"
    __table_args__ = (
        CheckConstraint(
            "role IN ('moderator', 'administrator', 'owner')", name="ck_admin_role"
        ),
        Index(
            "uq_admin_single_owner",
            "role",
            unique=True,
            postgresql_where=text("role = 'owner'"),
        ),
    )

    username: Mapped[str] = mapped_column(unique=True)
    password_hash: Mapped[str] = mapped_column()
    role: Mapped[str] = mapped_column()
    enabled: Mapped[bool] = mapped_column(default=True)
    session_version: Mapped[int] = mapped_column(default=1)
    totp_secret: Mapped[str | None] = mapped_column(Encrypted("admin.totp"))
    totp_confirmed: Mapped[bool] = mapped_column(default=False)
    last_totp_counter: Mapped[int] = mapped_column(BigInteger, default=-1)
    recovery_hashes: Mapped[list[str]] = mapped_column(JSONB, default=list)
    pending_nonce_hash: Mapped[str | None] = mapped_column()
    failed_attempts: Mapped[int] = mapped_column(default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AdminSession(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "admin_sessions"

    account_id: Mapped[UUID] = mapped_column(
        ForeignKey("admin_accounts.id"), index=True
    )
    token_hash: Mapped[str] = mapped_column(unique=True)
    session_version: Mapped[int] = mapped_column()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked: Mapped[bool] = mapped_column(default=False)
