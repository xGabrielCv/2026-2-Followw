import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from api.db.base import Base


class AppEvent(Base):
    """Eventos técnicos relevantes (avisos, erros, sincronização). Só metadados já filtrados pelo logger."""

    __tablename__ = "app_events"
    __table_args__ = (Index("ix_app_events_at_level", "at", "level"),)

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    level: Mapped[str] = mapped_column()
    event: Mapped[str] = mapped_column(index=True)
    fields: Mapped[dict] = mapped_column(JSONB, default=dict)
