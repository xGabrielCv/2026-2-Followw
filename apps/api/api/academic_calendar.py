"""Regras que dependem do calendário acadêmico da UnB (`unb_browser`)."""

import enum
import json
import re
from collections.abc import Iterator
from datetime import date, datetime, timedelta
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession
from unb_browser import (
    AcademicCalendar,
    CalendarEventCategory,
    SemesterCalendar,
    estimate_regular_semester,
    load_academic_calendar,
)

from api.db.enums import ClassroomStatus
from api.db.models import SystemText

CALENDAR_KEY = "academic_calendar"
COLLECTED_CALENDAR = (
    Path(__file__).resolve().parents[3] / ".local/data/academic_calendar.json"
)

_BRASILIA = ZoneInfo("America/Sao_Paulo")
_SEMESTER = re.compile(r"([0-9]{4})\.([0-9])")
# Dá tempo de o último sync da turma marcar os alunos como concluídos.
MEMBERS_TOLERANCE = timedelta(days=3)
# Docente que consolida a turma com atraso ainda tem a menção lida.
GRADES_TOLERANCE = timedelta(days=3)
_NO_CLASS = {
    CalendarEventCategory.HOLIDAY,
    CalendarEventCategory.OPTIONAL_HOLIDAY,
    CalendarEventCategory.UNIVERSITY_WEEK,
}


class Event(str, enum.Enum):
    """Os ids dos eventos do calendário que as regras usam."""

    GRADES_CONSOLIDATION = "grades_consolidation"
    SEMESTER_END = "semester_end"


def now() -> datetime:
    return datetime.now(_BRASILIA)


def today() -> date:
    return now().date()


def ended(
    semester: str,
    event: Event,
    tolerance: timedelta = timedelta(),
    on: date | None = None,
    calendar: AcademicCalendar | None = None,
) -> bool:
    calendar = calendar or default_calendar()
    semester_calendar = calendar.get_semester(semester)
    if semester_calendar is None:
        # Fora do calendário: o semestre anterior a ele já acabou, o posterior não.
        return semester < min(calendar.semesters)
    end = next((e.end_date for e in semester_calendar.events if e.id == event), None)
    return end is not None and (on or today()) > end + tolerance


def local_date(at: datetime) -> date:
    return at.astimezone(_BRASILIA).date()


def parse_semester(value: str) -> tuple[int, int] | None:
    """O semestre `AAAA.P` como (ano, período) ordenável; `None` fora do formato."""
    match = _SEMESTER.fullmatch(value)
    return (int(match[1]), int(match[2])) if match else None


def members_closed(semester: str) -> bool:
    """A tolerância do fim do semestre já passou: falta só o último sync dos participantes."""
    return ended(semester, Event.SEMESTER_END, MEMBERS_TOLERANCE)


def members_frozen(semester: str, synced_at: datetime) -> bool:
    """Os participantes sincronizados depois da tolerância não são ressincronizados."""
    return ended(semester, Event.SEMESTER_END, MEMBERS_TOLERANCE, local_date(synced_at))


def grades_closed(semester: str) -> bool:
    """A tolerância da consolidação já passou: a menção já deveria estar lançada."""
    return ended(semester, Event.GRADES_CONSOLIDATION, GRADES_TOLERANCE)


def member_status(semester: str) -> ClassroomStatus:
    if ended(semester, Event.SEMESTER_END):
        return ClassroomStatus.CONCLUIDO
    return ClassroomStatus.CURSANDO


def class_days(semester: str) -> Iterator[date]:
    """Os dias letivos do semestre, sem feriados e semana universitária."""
    calendar = default_calendar().get_semester(semester)
    if calendar is None:
        return
    start, end = calendar.classes.start, calendar.classes.end
    no_class = {
        day
        for event in calendar.events
        if event.category in _NO_CLASS
        for day in _days(max(event.start_date, start), min(event.end_date, end))
    }
    for day in _days(start, end):
        if day not in no_class:
            yield day


def _days(start: date, end: date) -> Iterator[date]:
    day = start
    while day <= end:
        yield day
        day += timedelta(days=1)


@lru_cache(maxsize=8)
def merged_calendar(raw: str | None = None) -> AcademicCalendar:
    base = load_academic_calendar()
    if not raw or raw == "{}":
        return base
    try:
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            return base
        payload = parsed.get("semesters") if "semesters" in parsed else parsed
        extra = {
            key: SemesterCalendar.model_validate(value)
            for key, value in payload.items()
            if isinstance(value, dict)
        }
    except ValueError, TypeError, ValidationError:
        return base
    return AcademicCalendar(semesters={**base.semesters, **extra})


async def read_custom_calendar(
    session: AsyncSession, *, include_collected: bool = True
) -> dict[str, dict]:
    collected = collected_calendar() if include_collected else {}
    row = await session.get(SystemText, CALENDAR_KEY)
    if row is None:
        return collected
    try:
        parsed = json.loads(row.value)
        payload = (
            parsed.get("semesters")
            if isinstance(parsed, dict) and "semesters" in parsed
            else parsed
        )
        if not isinstance(payload, dict):
            return collected
        validated = {
            key: SemesterCalendar.model_validate(value).model_dump(mode="json")
            for key, value in payload.items()
            if isinstance(value, dict)
        }
        return {**collected, **validated}
    except ValueError, TypeError, ValidationError:
        return collected


def collected_calendar() -> dict[str, dict]:
    try:
        calendar = AcademicCalendar.model_validate_json(
            COLLECTED_CALENDAR.read_text(encoding="utf-8")
        )
        return calendar.model_dump(mode="json")["semesters"]
    except OSError, ValueError:
        return {}


async def read_calendar(session: AsyncSession) -> AcademicCalendar:
    return merged_calendar(json.dumps(await read_custom_calendar(session)))


def current_regular_semester(
    day: date | None = None, calendar: AcademicCalendar | None = None
) -> str:
    """O último semestre regular (`.1` ou `.2`) já iniciado; nas férias, o que terminou."""
    day = day or today()
    cal = calendar or default_calendar()
    regular = [
        semester for semester in cal.list_semesters() if semester.semester[-1] in "12"
    ]
    started = [s.semester for s in regular if s.period.start <= day <= s.period.end]
    if started:
        return max(started)
    return estimate_regular_semester(day)


def is_enrollment_period(
    semester: str, day: date | None = None, calendar: AcademicCalendar | None = None
) -> bool:
    day = day or today()
    cal = calendar or default_calendar()
    entry = cal.get_semester(semester)
    if entry is None:
        return False
    return any(
        event.category == CalendarEventCategory.ENROLLMENT
        and event.start_date <= day <= event.end_date
        for event in entry.events
    )


def semester_progress_percent(
    day: date | None = None, calendar: AcademicCalendar | None = None
) -> int | None:
    day = day or today()
    cal = calendar or default_calendar()
    current = next(
        (s for s in cal.list_semesters() if s.period.start <= day <= s.period.end),
        None,
    )
    if current is None:
        return None
    total = (current.classes.end - current.classes.start).days + 1
    elapsed = min(total, max(0, (day - current.classes.start).days + 1))
    return round((elapsed / total) * 100)


def shift_regular_semester(semester: str, offset: int) -> str:
    """`2026.2` com -1 é `2026.1`; com +1, `2027.1`. Só conta semestres regulares."""
    year, term = (int(part) for part in semester.split("."))
    index = year * 2 + (term - 1) + offset
    return f"{index // 2}.{index % 2 + 1}"


def default_calendar() -> AcademicCalendar:
    return merged_calendar(json.dumps(collected_calendar()))
