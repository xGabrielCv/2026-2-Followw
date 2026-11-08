"""A frequência do aluno, lida do SIGAA a cada pedido e devolvida sem ser gravada."""

from typing import Annotated

from fastapi import Depends
from pydantic import BaseModel

from api import academic_calendar
from api.db.main import DatabaseDep
from api.modules.classrooms.lessons import (
    ClassroomFrequencyView,
    FrequencySummary,
    Timetable,
)
from api.modules.classrooms.repository import FrequencyRepository
from api.modules.classrooms.service import (
    ClassroomServiceDep,
    ParticipantClassroom,
    Turma,
    to_classroom,
)


class ClassroomFrequencyResult(BaseModel):
    classroom: ParticipantClassroom
    frequency: ClassroomFrequencyView


class FrequencyService:
    def __init__(self, db: DatabaseDep, classrooms: ClassroomServiceDep) -> None:
        self._db = db
        self._classrooms = classrooms

    async def get_frequency(self, classroom_id: str) -> ClassroomFrequencyView:
        return await self._view(await self._classrooms.get_turma(classroom_id))

    async def list_frequencies(self) -> list[ClassroomFrequencyResult]:
        turmas = await self._classrooms.list_turmas()
        # Em sequência: as turmas dividem a sessão do SIGAA.
        return [
            ClassroomFrequencyResult(
                classroom=to_classroom(turma), frequency=await self._view(turma)
            )
            for turma in turmas
        ]

    async def _view(self, turma: Turma) -> ClassroomFrequencyView:
        client = await self._classrooms.account.client()
        frequency = await client.classrooms.get_classroom_frequency(turma.front_end_id)
        timetable = Timetable.parse(turma.row.schedule)
        rows = await self._db.write(
            lambda session: FrequencyRepository(session).apply(
                turma.row.id, frequency, timetable
            )
        )
        return ClassroomFrequencyView.build(
            FrequencySummary.of(frequency),
            rows.lessons,
            now=academic_calendar.now(),
            workload=turma.row.subject.hours,
        )


FrequencyServiceDep = Annotated[FrequencyService, Depends()]
