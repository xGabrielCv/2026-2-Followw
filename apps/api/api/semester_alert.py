"""Configuração do alerta acadêmico de avaliações e compartilhamento controlado pelo admin."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import SystemText

KEY = "semester_alert"
AlertPreset = Literal["first_day", "last_day", "mid_semester", "custom"]

ALERT_PRESETS: dict[str, tuple[str, str]] = {
    "first_day": (
        "Avalie seus professores do semestre anterior",
        "Novo semestre começando! Aproveite para avaliar seus professores do semestre anterior e ajudar os colegas.",
    ),
    "mid_semester": (
        "50% do semestre: avalie seus professores",
        "Já passamos da metade do semestre. Avalie como estão sendo suas aulas e ajude outros estudantes.",
    ),
    "last_day": (
        "Último dia do semestre: avalie seus professores",
        "Último dia letivo do semestre! Avalie seus professores e compartilhe as estatísticas das suas turmas anonimamente.",
    ),
}


class SemesterAlertConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

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
    mid_semester_every_n: int = Field(default=3, ge=1, le=20)
    mid_semester_title: str = Field(
        default="50% do semestre: avalie seus professores",
        min_length=3,
        max_length=120,
    )
    mid_semester_message: str = Field(
        default="Já passamos da metade do semestre. Avalie como estão sendo suas aulas e ajude outros estudantes.",
        min_length=3,
        max_length=600,
    )
    last_day_enabled: bool = True
    last_day_title: str = Field(
        default="Último dia do semestre: avalie seus professores",
        min_length=3,
        max_length=120,
    )
    last_day_message: str = Field(
        default="Último dia letivo do semestre! Avalie seus professores e compartilhe as estatísticas das suas turmas anonimamente.",
        min_length=3,
        max_length=600,
    )
    first_day_enabled: bool = True
    first_day_title: str = Field(
        default="Avalie seus professores do semestre anterior",
        min_length=3,
        max_length=120,
    )
    first_day_message: str = Field(
        default="Novo semestre começando! Aproveite para avaliar seus professores do semestre anterior e ajudar os colegas.",
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
