from datetime import date
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CalendarEventCategory(StrEnum):
    ACADEMIC = "academic"
    ADMINISTRATIVE = "administrative"
    ENROLLMENT = "enrollment"
    HOLIDAY = "holiday"
    OPTIONAL_HOLIDAY = "optional_holiday"
    UNIVERSITY_WEEK = "university_week"
    OTHER = "other"


class CalendarPeriod(BaseModel):
    model_config = ConfigDict(frozen=True)

    start: date
    end: date

    @model_validator(mode="after")
    def ordered(self):
        if self.end < self.start:
            raise ValueError(
                "O fim do período precisa ser igual ou posterior ao início."
            )
        return self


class ClassesPeriod(CalendarPeriod):
    instructional_days: int = Field(ge=0, le=366)


class CalendarEvent(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str | None = None
    name: str
    start_date: date
    end_date: date
    category: CalendarEventCategory


class SemesterCalendar(BaseModel):
    model_config = ConfigDict(frozen=True)

    semester: str
    name: str
    period: CalendarPeriod
    classes: ClassesPeriod
    events: tuple[CalendarEvent, ...] = ()

    @model_validator(mode="after")
    def classes_within_period(self):
        if (
            not self.period.start
            <= self.classes.start
            <= self.classes.end
            <= self.period.end
        ):
            raise ValueError("As aulas precisam estar dentro do período letivo.")
        return self


class AcademicCalendar(BaseModel):
    model_config = ConfigDict(frozen=True)

    semesters: dict[str, SemesterCalendar]

    def get_semester(self, semester: str) -> SemesterCalendar | None:
        return self.semesters.get(semester)

    def list_semesters(self) -> tuple[SemesterCalendar, ...]:
        return tuple(self.semesters.values())


def estimate_regular_semester(day: date) -> str:
    """Estimativa determinística do semestre regular quando o calendário oficial ainda não foi importado."""
    if day.month <= 2:
        return f"{day.year - 1}.2"
    if day.month <= 7:
        return f"{day.year}.1"
    return f"{day.year}.2"
