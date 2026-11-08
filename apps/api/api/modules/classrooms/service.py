"""As turmas do aluno, lidas do SIGAA a cada pedido.

Do que vem, o banco guarda só a turma pública (horário, sala, docentes, aulas previstas e
índices); quem está nela e com qual menção fica só na resposta, e o navegador a guarda.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated

import sigaa_client
from fastapi import Depends
from pydantic import BaseModel, ConfigDict
from sigaa_client import ClassroomNotFound, Grade, StatisticsShare
from sqlalchemy.ext.asyncio import AsyncSession

from api import academic_calendar
from api.account import AccountDep
from api.db.courses import course_ids
from api.db.enums import ClassroomStatus
from api.db.main import DatabaseDep
from api.db.models import Classroom, Course
from api.modules.classrooms.repository import ClassroomRepository
from api.schemas import (
    ClassroomOffer,
    CourseRef,
    ProfessorRef,
    UnitRef,
    UserSubject,
    course_ref,
    professor_refs,
    unit_ref,
)


class ClassroomMember(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str
    registration: str
    photo: str | None = None
    email: str | None = None
    course: CourseRef | None = None
    unit: UnitRef | None = None


class ClassroomMembers(BaseModel):
    model_config = ConfigDict(frozen=True)

    students: list[ClassroomMember]
    monitors: list[ClassroomMember]
    professors: list[ProfessorRef]


class ParticipantClassroom(sigaa_client.Classroom, ClassroomOffer):
    """A turma com a menção do usuário, `None` enquanto não lançada."""

    subject: UserSubject
    grade: Grade | None = None
    status: ClassroomStatus | None = None


@dataclass(frozen=True)
class Turma:
    """Uma turma do aluno: o SIGAA a abre pelo `front_end_id`; `row` é a turma pública."""

    front_end_id: str
    row: Classroom
    current: bool


class ClassroomService:
    def __init__(self, account: AccountDep, db: DatabaseDep) -> None:
        self._account = account
        self._db = db

    @property
    def account(self):
        return self._account

    async def list_classrooms(
        self, semester: str | None = None
    ) -> list[ParticipantClassroom]:
        turmas = await self.list_turmas(semester)
        # A menção só existe nas encerradas: sem elas, nem vai ao relatório de notas.
        grades = (
            {
                (item.subject_code.strip().upper(), item.semester): item.grade
                for item in await self._account.grades()
            }
            if any(not turma.current for turma in turmas)
            else {}
        )
        return [to_classroom(turma, grades) for turma in turmas]

    async def list_turmas(self, semester: str | None = None) -> list[Turma]:
        """As turmas da lista do aluno, na ordem em que ela é exibida."""
        items = await self._account.classrooms()
        rows = await self._db.write(
            lambda session: ClassroomRepository(session).save_public(
                items, datetime.now(UTC)
            )
        )
        turmas = [
            Turma(item.id, rows[item.id], item.current)
            for item in items
            if item.id in rows and _in_semester(item, semester)
        ]
        turmas.sort(key=lambda turma: (turma.row.subject.name, turma.row.number))
        return sorted(turmas, key=lambda turma: turma.row.semester, reverse=True)

    async def get_turma(self, classroom_id: str) -> Turma:
        """A turma pelo `frontEndIdTurma` ou pelo `sigaa_id`, se for do aluno."""
        row = await self._db.read(
            lambda session: ClassroomRepository(session).find(classroom_id)
        )
        if row is not None and row.front_end_id is not None:
            return Turma(row.front_end_id, row, _is_current(row.semester))
        # Turma ainda desconhecida: a lista do aluno a traz (e diz se é dele).
        for turma in await self.list_turmas("all"):
            if classroom_id in (turma.front_end_id, str(turma.row.sigaa_id)):
                return turma
        raise ClassroomNotFound(f"Turma `{classroom_id}` não é do usuário.")

    async def list_members(self, classroom_id: str) -> ClassroomMembers:
        turma = await self.get_turma(classroom_id)
        client = await self._account.client()
        members = await client.classrooms.list_classroom_members(turma.front_end_id)
        return await self._db.write(
            lambda session: _members(session, turma.row.id, members)
        )

    async def get_statistics(self, classroom_id: str) -> list[StatisticsShare]:
        turma = await self.get_turma(classroom_id)
        if turma.current:
            return []
        client = await self._account.client()
        shares = await client.classrooms.get_classroom_statistics(turma.front_end_id)
        # O índice da turma encerrada é público e anônimo: alimenta as estatísticas.
        await self._db.write(
            lambda session: ClassroomRepository(session).save_statistics(
                turma.row.id, shares, datetime.now(UTC)
            )
        )
        return list(shares)


def _in_semester(item: sigaa_client.Classroom, semester: str | None) -> bool:
    if semester is None:
        return item.current
    return semester == "all" or item.semester == semester


def _is_current(semester: str) -> bool:
    return academic_calendar.member_status(semester) is ClassroomStatus.CURSANDO


def to_classroom(
    turma: Turma, grades: dict[tuple[str, str], Grade | None] | None = None
) -> ParticipantClassroom:
    classroom = turma.row
    subject = classroom.subject
    grade = (grades or {}).get((classroom.subject_code, classroom.semester))
    return ParticipantClassroom(
        id=turma.front_end_id,
        sigaa_id=classroom.sigaa_id,
        number=classroom.number,
        semester=classroom.semester,
        schedule=classroom.schedule,
        room=classroom.room,
        current=turma.current,
        subject=UserSubject(
            code=subject.code,
            name=subject.name,
            hours=subject.hours,
            unit=unit_ref(subject.unit),
        ),
        grade=None if turma.current else grade,
        status=academic_calendar.member_status(classroom.semester),
        professors=professor_refs(classroom.professors),
        vacancies=classroom.vacancies,
        occupied=classroom.occupied,
    )


async def _members(
    session: AsyncSession,
    classroom_id: object,
    members: list[sigaa_client.ClassroomMember],
) -> ClassroomMembers:
    """Os docentes (públicos) vão para o banco; alunos e monitores, só para a resposta."""
    repository = ClassroomRepository(session)
    professors = await repository.save_professor_members(classroom_id, members)
    people = [
        m
        for m in members
        if m.role != sigaa_client.ClassroomRole.PROFESSOR and m.registration
    ]
    ids = await course_ids(session, {(m.course, m.unit) for m in people})
    courses = {
        course.id: course for course in await repository.courses(set(ids.values()))
    }

    def member(m: sigaa_client.ClassroomMember) -> ClassroomMember:
        assert m.registration is not None
        course: Course | None = courses.get(ids.get((m.course or "", m.unit or ""), -1))
        return ClassroomMember(
            name=m.name,
            registration=m.registration,
            photo=m.photo,
            email=m.email,
            course=course_ref(course),
            unit=unit_ref(course.unit) if course else None,
        )

    def of(role: sigaa_client.ClassroomRole) -> list[ClassroomMember]:
        chosen = [member(m) for m in people if m.role == role]
        return sorted(chosen, key=lambda m: m.name)

    return ClassroomMembers(
        students=of(sigaa_client.ClassroomRole.ALUNO),
        monitors=of(sigaa_client.ClassroomRole.MONITOR),
        professors=list(professor_refs(professors)),
    )


ClassroomServiceDep = Annotated[ClassroomService, Depends()]
