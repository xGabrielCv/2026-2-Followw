import json
import re
from datetime import date
from functools import lru_cache
from importlib import resources

import httpx

from ..config import ACADEMIC_CALENDAR_URL
from ..exceptions import UnbParseError
from ..utils.http import fetch_page
from .models import AcademicCalendar, SemesterCalendar

_PERIOD = re.compile(
    r"(?P<semester>\d{4}\.[12]):\s*(?P<sd>\d{1,2})/(?P<sm>\d{1,2})"
    r"\s+a\s+(?P<ed>\d{1,2})/(?P<em>\d{1,2})/(?P<year>\d{4})"
    r"(?:\s*\((?P<days>\d+)\s+dias letivos\))?"
)


@lru_cache(maxsize=1)
def load_academic_calendar() -> AcademicCalendar:
    """Carrega o calendário acadêmico estático em memória a partir do JSON."""
    data_path = resources.files("unb_browser.calendar").joinpath(
        "academic_calendar.json"
    )
    with data_path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    return AcademicCalendar.model_validate(data)


class Calendar:
    """Resource de consulta ao calendário acadêmico oficial da UnB."""

    def __init__(self, http: httpx.AsyncClient | None = None) -> None:
        self._calendar = load_academic_calendar()
        self._http = http

    async def fetch_periods(self) -> AcademicCalendar:
        """Lê somente períodos de aulas explicitamente publicados, sem inventar prazos."""
        if self._http is None:
            raise ValueError("Consulta remota exige o cliente UnbBrowser.")
        page = await fetch_page(self._http, ACADEMIC_CALENDAR_URL)
        semesters = {}
        for item in page.select("li"):
            match = _PERIOD.fullmatch(item.get_text(" ", strip=True))
            if not match:
                continue
            semester = match["semester"]
            year = int(match["year"])
            if year != int(semester[:4]):
                continue
            try:
                start = date(year, int(match["sm"]), int(match["sd"]))
                end = date(year, int(match["em"]), int(match["ed"]))
            except ValueError:
                continue
            if not 30 <= (end - start).days <= 200:
                continue
            classes = {
                "start": start,
                "end": end,
                "instructional_days": int(match["days"] or 0),
            }
            entry = SemesterCalendar.model_validate(
                {
                    "semester": semester,
                    "name": f"{semester[-1]}º Semestre de {year}",
                    "period": {"start": start, "end": end},
                    "classes": classes,
                }
            )
            if semester in semesters and semesters[semester] != entry:
                raise UnbParseError(
                    "SAA publicou períodos conflitantes para o mesmo semestre."
                )
            semesters[semester] = entry
        if not semesters:
            raise UnbParseError("Períodos de aulas ausentes na página da SAA.")
        return AcademicCalendar(semesters=semesters)

    def get_calendar(self) -> AcademicCalendar:
        """Devolve o calendário acadêmico completo."""
        return self._calendar

    def get_semester(self, semester: str) -> SemesterCalendar | None:
        """Devolve os dados de um semestre específico (ex: '2026.1')."""
        return self._calendar.get_semester(semester)

    def list_semesters(self) -> tuple[SemesterCalendar, ...]:
        """Lista todos os semestres disponíveis."""
        return self._calendar.list_semesters()
