from datetime import datetime

from sqlalchemy import DateTime, Integer
from sqlalchemy.orm import Mapped, mapped_column

from api.db.base import Base


class UsedCommunityPermission(Base):
    """Só detecta reutilização por dois minutos; não registra autor, endereço ou conta."""

    __tablename__ = "community_permission_uses"

    digest: Mapped[str] = mapped_column(primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class UploadBudget(Base):
    """Cota diária por credencial e matéria; nenhum vínculo com arquivos ou conta acadêmica."""

    __tablename__ = "community_upload_budgets"
    digest: Mapped[str] = mapped_column(primary_key=True)
    count: Mapped[int] = mapped_column(Integer)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
