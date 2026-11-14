"""Configuração do alerta acadêmico de avaliações e compartilhamento controlado pelo admin."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import SystemText

KEY = "semester_alert"
AlertPreset = Literal["first_day", "last_day", "custom"]

ALERT_PRESETS: dict[str, tuple[str, str]] = {
    "first_day": (
        "Início do semestre",
        "Novo semestre começando! Aproveite para avaliar seus professores dos semestres anteriores e ajudar os colegas.",
    ),
    "last_day": (
        "Fim do semestre",
        "Últimos dias do semestre! Avalie seus professores e compartilhe as estatísticas das suas turmas anonimamente.",
    ),
}


class SemesterAlertConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = True
    always_on: bool = False
    preset: AlertPreset = "custom"
    title: str = Field(
        default="Avalie seus professores do semestre",
        min_length=3,
        max_length=120,
    )
    message: str = Field(
        default="Sua avaliação é anônima e ajuda outros alunos na escolha das turmas.",
        min_length=3,
        max_length=600,
    )
    mid_semester_enabled: bool = True
    mid_semester_chance: int = Field(default=35, ge=0, le=100)
    mid_semester_title: str = Field(
        default="Metade do semestre: avalie seus professores!",
        min_length=3,
        max_length=120,
    )
    mid_semester_message: str = Field(
        default="Já passamos da metade do semestre. Avalie como estão sendo suas aulas e ajude outros estudantes.",
        min_length=3,
        max_length=600,
    )
    trigger_id: str = Field(default="default", min_length=1, max_length=64)
    triggered_at: datetime | None = None


async def read_alert(session: AsyncSession) -> SemesterAlertConfig:
    row = await session.get(SystemText, KEY)
    if row is None:
        return SemesterAlertConfig()
    try:
        return SemesterAlertConfig.model_validate_json(row.value)
    except ValidationError:
        return SemesterAlertConfig()


async def save_alert(
    session: AsyncSession, value: SemesterAlertConfig
) -> SemesterAlertConfig:
    row = await session.get(SystemText, KEY)
    serialized = value.model_dump_json()
    if row is None:
        session.add(SystemText(key=KEY, value=serialized))
    else:
        row.value = serialized
    return value
