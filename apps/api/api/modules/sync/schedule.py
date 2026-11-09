"""Horários e limites da sincronização; a administração só escolhe dentro destes limites."""

import re
from datetime import UTC, datetime, time, timedelta, timezone
from itertools import pairwise
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

try:
    BRASILIA = ZoneInfo("America/Sao_Paulo")
except (
    ZoneInfoNotFoundError
):  # sem tzdata; o Brasil não tem horário de verão desde 2019
    BRASILIA = timezone(timedelta(hours=-3))

KEY = "sync_settings"
# Lista fechada: a administração nunca informa um endereço, um comando ou um caminho.
SOURCES = {
    "catalog": "Catálogo do SIGAA público (turmas, matérias e docentes)",
    "restaurant": "Cardápio do RU",
}
HHMM = Annotated[str, StringConstraints(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]
MIN_GAP = timedelta(hours=1)


def parse_time(value: str) -> time:
    if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", value):
        raise ValueError("Horário inválido.")
    return time(int(value[:2]), int(value[3:]))


class SyncSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    catalog_enabled: bool = True
    # Horários do catálogo em America/Sao_Paulo; padrão: 00:00, 08:00 e 16:00.
    catalog_times: list[HHMM] = Field(
        default=["00:00", "08:00", "16:00"], min_length=1, max_length=6
    )
    restaurant_enabled: bool = True
    restaurant_time: HHMM = "06:00"
    timeout_seconds: int = Field(default=5400, ge=60, le=7200)
    backoff_minutes: int = Field(default=15, ge=5, le=120)
    max_backoff_hours: int = Field(default=6, ge=1, le=24)
    manual_cooldown_seconds: int = Field(default=300, ge=60, le=3600)
    # Na subida, só sincroniza se a última execução com sucesso for mais velha que isto.
    startup_max_age_hours: int = Field(default=8, ge=1, le=24)
    history_limit: int = Field(default=200, ge=50, le=1000)

    @field_validator("catalog_times")
    @classmethod
    def spaced(cls, value: list[str]) -> list[str]:
        ordered = sorted(set(value))
        if len(ordered) != len(value):
            raise ValueError("Horários repetidos.")
        minutes = [parse_time(v).hour * 60 + parse_time(v).minute for v in ordered]
        gaps = [b - a for a, b in pairwise(minutes)]
        gaps.append(minutes[0] + 24 * 60 - minutes[-1])
        if len(ordered) > 1 and min(gaps) < MIN_GAP.total_seconds() / 60:
            raise ValueError("Deixe pelo menos 1 hora entre as execuções.")
        return ordered

    def times_for(self, source: str) -> list[str]:
        return self.catalog_times if source == "catalog" else [self.restaurant_time]

    def enabled_for(self, source: str) -> bool:
        return self.catalog_enabled if source == "catalog" else self.restaurant_enabled


def next_run(after: datetime, times: list[str]) -> datetime:
    """Próximo horário estritamente depois de `after`, no relógio de Brasília, devolvido em UTC."""
    local = after.astimezone(BRASILIA)
    candidates = []
    for day in (0, 1):
        date = (local + timedelta(days=day)).date()
        for value in times:
            moment = datetime.combine(date, parse_time(value), tzinfo=BRASILIA)
            if moment > local:
                candidates.append(moment)
    return min(candidates).astimezone(UTC)


def backoff(failures: int, settings: SyncSettings) -> timedelta:
    """Exponencial a partir de `backoff_minutes`, limitado a `max_backoff_hours`."""
    delay = timedelta(minutes=settings.backoff_minutes) * (2 ** max(failures - 1, 0))
    return min(delay, timedelta(hours=settings.max_backoff_hours))
