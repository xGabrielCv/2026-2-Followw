"""O perfil do aluno: vem do cookie cifrado do navegador (ou do SIGAA) e nunca vai para o banco."""

from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

import sigaa_client
from fastapi import Depends
from pydantic import BaseModel, ConfigDict
from sigaa_client import CurriculumWorkload, UserLevel
from sqlalchemy.ext.asyncio import AsyncSession

from api.account import AccountDep
from api.db.courses import course_ids
from api.db.main import DatabaseDep
from api.db.models import Course, Curriculum
from api.modules.public_courses.repository import PublicCourseRepository
from api.modules.recommendations.ranking import CurriculumInfo, select_curriculum
from api.schemas import CourseRef, UnitRef, course_ref, unit_ref


class UserProfile(BaseModel):
    """O perfil como a API devolve: sem curso conhecido, curso e unidade são nulos."""

    model_config = ConfigDict(frozen=True)

    name: str
    registration: str
    photo: str | None
    email: str | None = None
    bio: str | None
    unit: UnitRef | None
    course: CourseRef | None
    entry_semester: str | None
    integralization: int | None
    workload: CurriculumWorkload | None
    # Carga horária máxima por período da matriz do aluno, em horas.
    period_max_workload: int | None
    ira: float | None
    mp: float | None
    level: UserLevel


@dataclass(frozen=True)
class Enrollment:
    """Curso e matriz do aluno pelo catálogo público, a partir do perfil."""

    course: Course | None
    curriculum: Curriculum | None

    @property
    def course_id(self) -> int | None:
        return self.course.id if self.course else None

    @property
    def curriculum_id(self) -> UUID | None:
        return self.curriculum.id if self.curriculum else None


async def enrollment(
    session: AsyncSession, profile: sigaa_client.UserProfile
) -> Enrollment:
    """A matriz pelo semestre de entrada, como o SIGAA não a informa."""
    pair = (profile.course, profile.unit)
    shift = profile.shift.value if profile.shift else None
    course_id = (await course_ids(session, [pair], shift)).get(pair)
    if course_id is None:
        return Enrollment(None, None)
    course = await session.get_one(Course, course_id)
    curriculum = None
    if profile.entry_semester is not None:
        options = [
            CurriculumInfo.model_validate(c)
            for c in await PublicCourseRepository(session).list_curricula(course_id)
        ]
        selected = select_curriculum(options, profile.entry_semester, course.shift)
        curriculum = await session.get(Curriculum, selected.id) if selected else None
    return Enrollment(course, curriculum)


class ProfileService:
    def __init__(self, account: AccountDep, db: DatabaseDep) -> None:
        self._account = account
        self._db = db

    async def get_profile(self) -> UserProfile:
        profile = await self._account.profile()
        return await self._db.write(lambda session: _to_profile(session, profile))


async def _to_profile(
    session: AsyncSession, profile: sigaa_client.UserProfile
) -> UserProfile:
    found = await enrollment(session, profile)
    return UserProfile(
        name=profile.name,
        registration=profile.registration,
        photo=profile.photo,
        email=profile.email,
        bio=profile.bio,
        unit=unit_ref(found.course.unit) if found.course else None,
        course=course_ref(found.course),
        entry_semester=profile.entry_semester,
        integralization=profile.integralization,
        workload=profile.workload,
        period_max_workload=found.curriculum.period_max_workload
        if found.curriculum
        else None,
        ira=profile.ira,
        mp=profile.mp,
        level=profile.level,
    )


ProfileServiceDep = Annotated[ProfileService, Depends()]
