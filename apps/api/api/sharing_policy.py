"""Política pública de reenvio automático das estatísticas de turmas, configurável pelo admin."""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import SystemText

KEY = "statistics_sharing_policy"


class StatisticsSharingPolicy(BaseModel):
    """Regras globais (sem dados pessoais) que orientam quando o app reenvia estatísticas."""

    model_config = ConfigDict(extra="forbid")

    semester_percent: int = Field(default=98, ge=50, le=100)
    interval_days: int = Field(default=180, ge=30, le=365)
    trigger_id: str | None = Field(default=None, min_length=1, max_length=64)
    triggered_at: datetime | None = None


async def read_sharing_policy(session: AsyncSession) -> StatisticsSharingPolicy:
    row = await session.get(SystemText, KEY)
    if row is None:
        return StatisticsSharingPolicy()
    try:
        return StatisticsSharingPolicy.model_validate_json(row.value)
    except ValidationError:
        return StatisticsSharingPolicy()


async def save_sharing_policy(
    session: AsyncSession, value: StatisticsSharingPolicy
) -> StatisticsSharingPolicy:
    row = await session.get(SystemText, KEY)
    serialized = value.model_dump_json()
    if row is None:
        session.add(SystemText(key=KEY, value=serialized))
    else:
        row.value = serialized
    return value
