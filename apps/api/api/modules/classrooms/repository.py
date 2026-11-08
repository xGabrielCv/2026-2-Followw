"""Só o que é público na turma: nada aqui diz quem está nela."""

from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from uuid import UUID, uuid4

import sigaa_client
from sigaa_client import AttendanceStatus
from sqlalchemy import delete, select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api import academic_calendar
from api.academic_calendar import parse_semester
from api.db.enums import LessonStatus
from api.db.models import Classroom, Course, Lesson, Professor, Subject
from api.db.professors import (
    SeenProfessor,
    save_classroom_professors,
    save_professors,
)
from api.db.units import unit_ids
from api.modules.classrooms.lessons import (
    Attendance,
    Period,
    Timetable,
    lesson_order,
    positioned,
)


class ClassroomRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._lessons = LessonRepository(session)

    async def save_public(
        self, items: Sequence[sigaa_client.Classroom], synced_at: datetime
    ) -> dict[str, Classroom]:
        """Grava as turmas públicas da lista do aluno; devolve cada uma pelo `front_end_id`."""
        keyed = [(key, item) for item in items if (key := _classroom_key(item))]
        # O histórico tem dezenas de turmas: turmas e componentes vêm de uma vez.
        saved = await self._classrooms_by_key([key for key, _ in keyed])
        subjects = await self._subjects({key[0] for key, _ in keyed})
        units = await unit_ids(self._session, {item.subject.unit for _, item in keyed})
        current: list[Classroom] = []
        ids: dict[str, UUID] = {}
        for key, item in keyed:
            classroom = saved.get(key)
            # Turma de semestre passado quase não muda: só a nova é gravada.
            if classroom is None or item.current:
                classroom = saved[key] = await self._save_classroom(
                    key, item, classroom, subjects, units
                )
            classroom.front_end_id = classroom.front_end_id or item.id
            if item.current:
                current.append(classroom)
            ids[item.id] = classroom.id
        await self._lessons.plan(current, synced_at)
        await self._session.flush()
        rows = await self._loaded(set(ids.values()))
        return {front_end_id: rows[id_] for front_end_id, id_ in ids.items()}

    async def find(self, classroom_id: str) -> Classroom | None:
        """Pelo `frontEndIdTurma` ou pelo `sigaa_id`."""
        query = select(Classroom).options(selectinload(Classroom.subject))
        row = await self._session.scalar(
            query.where(Classroom.front_end_id == classroom_id).limit(1)
        )
        # Cabe no INTEGER da coluna; fora disso nem chega ao banco.
        if row is None and classroom_id.isdecimal() and int(classroom_id) < 2**31:
            row = await self._session.scalar(
                query.where(Classroom.sigaa_id == int(classroom_id)).limit(1)
            )
        return row

    async def offer_semester(self) -> str | None:
        """O semestre mais recente entre as turmas gravadas."""
        values = await self._session.scalars(select(Classroom.semester).distinct())
        return max(
            (value for value in values if parse_semester(value)),
            key=parse_semester,
            default=None,
        )

    async def offered_subject_codes(self, semester: str | None) -> list[str]:
        return list(
            await self._session.scalars(
                select(Classroom.subject_code).where(Classroom.semester == semester)
            )
        )

    async def save_statistics(
        self,
        classroom_id: UUID,
        shares: Sequence[sigaa_client.StatisticsShare],
        synced_at: datetime,
    ) -> None:
        classroom = await self._session.get_one(Classroom, classroom_id)
        classroom.statistics = [share.model_dump(mode="json") for share in shares]
        classroom.statistics_synced_at = synced_at
        await self._session.flush()

    async def save_professor_members(
        self, classroom_id: UUID, members: Sequence[sigaa_client.ClassroomMember]
    ) -> list[Professor]:
        """Os docentes da lista de participantes, que são públicos."""
        professor_members = [
            m for m in members if m.role == sigaa_client.ClassroomRole.PROFESSOR
        ]
        if not professor_members:
            classroom = await self._loaded({classroom_id})
            return list(classroom[classroom_id].professors)
        units = await unit_ids(
            self._session, {_department(m) for m in professor_members}
        )
        professors = await save_professors(
            self._session,
            [
                SeenProfessor(
                    name=m.name,
                    email=m.email,
                    person_id=m.person_id,
                    photo=m.photo,
                    unit_id=units.get(_department(m) or ""),
                )
                for m in professor_members
            ],
        )
        await save_classroom_professors(self._session, {classroom_id: professors})
        return sorted(professors, key=lambda professor: professor.name)

    async def courses(self, ids: Collection[int]) -> list[Course]:
        if not ids:
            return []
        return list(
            await self._session.scalars(select(Course).where(Course.id.in_(ids)))
        )

    async def _loaded(self, ids: Collection[UUID]) -> dict[UUID, Classroom]:
        if not ids:
            return {}
        rows = await self._session.scalars(
            select(Classroom)
            .where(Classroom.id.in_(ids))
            .options(selectinload(Classroom.subject))
            .execution_options(populate_existing=True)
        )
        return {row.id: row for row in rows}

    async def _classrooms_by_key(
        self, keys: Sequence[_ClassroomKey]
    ) -> dict[_ClassroomKey, Classroom]:
        if not keys:
            return {}
        rows = await self._session.scalars(
            select(Classroom).where(
                tuple_(
                    Classroom.subject_code, Classroom.number, Classroom.semester
                ).in_(keys)
            )
        )
        return {(row.subject_code, row.number, row.semester): row for row in rows}

    async def _subjects(self, codes: Collection[str]) -> dict[str, Subject]:
        if not codes:
            return {}
        rows = await self._session.scalars(
            select(Subject).where(Subject.code.in_(codes))
        )
        return {row.code: row for row in rows}

    def _save_subject(
        self,
        code: str,
        item: sigaa_client.Subject,
        subjects: dict[str, Subject],
        units: Mapping[str, int],
    ) -> None:
        subject = subjects.get(code)
        if subject is None:
            subject = subjects[code] = Subject(code=code)
            self._session.add(subject)

        subject.name = item.name
        subject.hours = item.hours or subject.hours
        # A unidade ofertante do seed vale mais que o palpite pelo prefixo do local.
        subject.unit_id = subject.unit_id or units.get(item.unit or "")

    async def _save_classroom(
        self,
        key: _ClassroomKey,
        item: sigaa_client.Classroom,
        classroom: Classroom | None,
        subjects: dict[str, Subject],
        units: Mapping[str, int],
    ) -> Classroom:
        code, number, semester = key
        self._save_subject(code, item.subject, subjects, units)
        if classroom is None:
            # O id vem antes do flush: a lista devolve a turma por ele.
            classroom = Classroom(
                id=uuid4(), subject_code=code, number=number, semester=semester
            )
            self._session.add(classroom)

        # A turma é compartilhada: quem vê só o histórico não apaga a sala que o
        # portal de outro aluno trouxe.
        classroom.sigaa_id = item.sigaa_id or classroom.sigaa_id
        schedule = item.schedule or classroom.schedule
        if schedule != classroom.schedule:
            await self._lessons.reset(classroom)
        classroom.schedule = schedule
        classroom.room = item.room or classroom.room

        return classroom


class LessonRepository:
    """As aulas da turma, criadas uma vez pelo horário e calendário."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def plan(
        self, classrooms: Collection[Classroom], created_at: datetime
    ) -> None:
        """Cria as aulas das turmas que ainda não as têm; as excluídas não voltam."""
        plans = {
            classroom.id: (classroom, planned)
            for classroom in classrooms
            if classroom.lessons_created_at is None
            and (
                planned := Timetable.parse(classroom.schedule).plan(
                    academic_calendar.class_days(classroom.semester)
                )
            )
        }
        if not plans:
            return
        # Aulas que o SIGAA publicou antes do plano entram nele.
        published = {
            (lesson.classroom_id, lesson.occurred_on, lesson.start_time): lesson
            for lesson in await self._session.scalars(
                select(Lesson).where(Lesson.classroom_id.in_(plans))
            )
        }
        for classroom, planned in plans.values():
            for day, period in planned:
                lesson = published.get((classroom.id, day, period.start))
                if lesson is None:
                    lesson = _new_lesson(classroom.id, day, period)
                    self._session.add(lesson)
                lesson.scheduled = True
            classroom.lessons_created_at = created_at

    async def reset(self, classroom: Classroom) -> None:
        """Apaga as aulas para um novo plano pelo horário novo."""
        if classroom.lessons_created_at is None:
            return
        await self._session.execute(
            delete(Lesson).where(Lesson.classroom_id == classroom.id)
        )
        classroom.lessons_created_at = None


@dataclass(frozen=True)
class FrequencyRows:
    """As aulas da turma com a situação do aluno nesta leitura do SIGAA, sem gravá-la."""

    lessons: list[tuple[Lesson, Attendance | None]]
    progress: sigaa_client.ClassroomProgress


class FrequencyRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def apply(
        self,
        classroom_id: UUID,
        frequency: sigaa_client.ClassroomFrequency,
        timetable: Timetable,
    ) -> FrequencyRows:
        """Casa a chamada do SIGAA com as aulas da turma, que são de todos os alunos.

        Grava só a aula publicada fora do plano e o andamento; a presença do aluno volta na
        resposta e não fica no banco.
        """
        attendance = frequency.frequency
        lessons = await self._lessons_by_day(classroom_id)
        entries = self._match(
            classroom_id,
            lessons,
            attendance.entries if attendance else (),
            timetable,
        )
        await self._drop_unpublished(lessons, entries)
        classroom = await self._session.get_one(Classroom, classroom_id)
        classroom.progress_taught = frequency.progress.taught
        classroom.progress_total = frequency.progress.total
        classroom.progress_percentage = frequency.progress.percentage
        await self._session.flush()
        return FrequencyRows(
            lessons=[
                (lesson, _attendance(entries.get(lesson.id)))
                for day in lessons.values()
                for lesson in day
                if lesson.scheduled or lesson.id in entries
            ],
            progress=frequency.progress,
        )

    async def lessons(self, classroom_id: UUID) -> list[Lesson]:
        return list(
            await self._session.scalars(
                select(Lesson).where(Lesson.classroom_id == classroom_id)
            )
        )

    async def _lessons_by_day(self, classroom_id: UUID) -> dict[date, list[Lesson]]:
        lessons: dict[date, list[Lesson]] = {}
        for lesson in sorted(await self.lessons(classroom_id), key=lesson_order):
            lessons.setdefault(lesson.occurred_on, []).append(lesson)
        return lessons

    def _match(
        self,
        classroom_id: UUID,
        lessons: dict[date, list[Lesson]],
        entries: Sequence[sigaa_client.AttendanceEntry],
        timetable: Timetable,
    ) -> dict[UUID, sigaa_client.AttendanceEntry]:
        """Cada entrada do SIGAA vai para a aula na mesma ordem do dia; sem ela, uma nova."""
        matched: dict[UUID, sigaa_client.AttendanceEntry] = {}
        for (day, position), entry in positioned(entries):
            day_lessons = lessons.setdefault(day, [])
            if position >= len(day_lessons):
                period = timetable.period(day, position)
                # O horário já usado no dia fica para a aula do plano.
                if period and period.start in {
                    other.start_time for other in day_lessons
                }:
                    period = None
                # Uma só aula sem horário por dia: as demais entradas ficam de fora.
                if period is None and any(
                    other.start_time is None for other in day_lessons
                ):
                    continue
                lesson = _new_lesson(classroom_id, day, period, scheduled=False)
                self._session.add(lesson)
                day_lessons.append(lesson)
            matched[day_lessons[position].id] = entry
        return matched

    async def _drop_unpublished(
        self,
        lessons: Mapping[date, Sequence[Lesson]],
        entries: Mapping[UUID, sigaa_client.AttendanceEntry],
    ) -> None:
        """Aulas fora do plano que o SIGAA retirou."""
        dropped = [
            lesson.id
            for day in lessons.values()
            for lesson in day
            if not lesson.scheduled and lesson.id not in entries
        ]
        if not dropped:
            return
        await self._session.flush()
        await self._session.execute(delete(Lesson).where(Lesson.id.in_(dropped)))


def _attendance(entry: sigaa_client.AttendanceEntry | None) -> Attendance | None:
    """A chamada do SIGAA; sem registro, a aula fica sem situação."""
    if entry is None or entry.status is AttendanceStatus.NAO_REGISTRADA:
        return None
    return Attendance(LessonStatus(entry.status.value), entry.absences)


def _new_lesson(
    classroom_id: UUID, day: date, period: Period | None, *, scheduled: bool = True
) -> Lesson:
    # O id vem antes do flush: a chamada do SIGAA aponta para ele.
    return Lesson(
        id=uuid4(),
        classroom_id=classroom_id,
        occurred_on=day,
        start_time=period.start if period else None,
        end_time=period.end if period else None,
        scheduled=scheduled,
    )


# A turma pelo componente, número e semestre.
type _ClassroomKey = tuple[str, str, str]


def _classroom_key(item: sigaa_client.Classroom) -> _ClassroomKey | None:
    # Turma só do portal vem sem número nem código: gravá-la duplicaria a do histórico.
    if not item.number or item.subject.code is None:
        return None
    return item.subject.code.strip().upper(), item.number, item.semester


def _department(member: sigaa_client.ClassroomMember) -> str | None:
    """`CAMPUS UNB GAMA: FCTE` -> `FCTE`, a sigla da unidade do docente."""
    if not member.unit:
        return None
    return member.unit.rpartition(":")[2].strip() or None
