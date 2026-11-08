"""Grupos de conversa das turmas: qualquer aluno logado cadastra e edita, sem autor."""

import uuid
from typing import Annotated, Literal, Self
from urllib.parse import urlsplit

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field, StringConstraints, model_validator
from sqlalchemy import ColumnElement, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.main import DatabaseDep
from api.db.models import Classroom, ClassroomGroup, Subject
from api.db.pagination import paginate
from api.db.search import all_terms, contains_term

Platform = Literal["whatsapp", "telegram", "teams", "aprender3"]
Campus = Literal["darcy", "gama", "ceilandia", "planaltina"]

MAX_GROUPS = 3
GROUPS_PAGE_SIZE = 20

# Só links das próprias plataformas: o grupo fica visível para todos os alunos.
_HOSTS: dict[str, tuple[str, ...]] = {
    "whatsapp": ("chat.whatsapp.com",),
    "telegram": ("t.me", "telegram.me"),
    "teams": ("teams.microsoft.com", "teams.live.com"),
    "aprender3": ("aprender3.unb.br",),
}
# Unidade de cada campus fora do Darcy Ribeiro.
_CAMPUS_UNITS = {"gama": 673, "ceilandia": 672, "planaltina": 666}


class GroupLink(BaseModel):
    platform: Platform
    url: Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)]
    password: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=64)] | None
    ) = Field(default=None, description="Chave de inscrição; só no Aprender 3.")

    @model_validator(mode="after")
    def _platform_link(self) -> Self:
        parts = urlsplit(self.url)
        host = (parts.hostname or "").lower()
        if parts.scheme != "https" or not any(
            host == allowed or host.endswith(f".{allowed}")
            for allowed in _HOSTS[self.platform]
        ):
            raise ValueError("O link precisa ser https e da plataforma escolhida.")
        if self.platform != "aprender3" or not self.password:
            self.password = None
        return self


class GroupsInput(BaseModel):
    groups: list[GroupLink] = Field(max_length=MAX_GROUPS)


class ClassroomRef(BaseModel):
    code: str
    name: str
    number: str
    semester: str


class SavedGroup(BaseModel):
    id: uuid.UUID
    platform: Platform
    url: str
    password: str | None


class ClassroomGroups(BaseModel):
    classroom: ClassroomRef
    groups: list[SavedGroup]


class GroupedClassroom(ClassroomRef):
    schedule: str | None
    room: str | None
    professors: list[str]
    groups: int


class GroupedClassroomPage(BaseModel):
    items: list[GroupedClassroom]
    total: int
    page: int
    page_size: int


def _campus(campus: Campus) -> ColumnElement[bool]:
    if campus == "darcy":
        return or_(
            Subject.unit_id.is_(None), Subject.unit_id.not_in(_CAMPUS_UNITS.values())
        )
    return Subject.unit_id == _CAMPUS_UNITS[campus]


def _matches(term: str) -> ColumnElement[bool]:
    return or_(
        Subject.code.contains(term.upper(), autoescape=True),
        contains_term(Subject.name, term),
    )


class GroupService:
    def __init__(self, db: DatabaseDep) -> None:
        self._db = db

    async def list(
        self,
        semester: str,
        q: str | None,
        campus: Campus | None,
        with_groups: bool,
        page: int,
        page_size: int,
    ) -> GroupedClassroomPage:
        conditions: list[ColumnElement[bool]] = [Classroom.semester == semester]
        if q is not None:
            conditions.append(all_terms(q, _matches))
        if campus is not None:
            conditions.append(_campus(campus))
        if with_groups:
            conditions.append(
                Classroom.id.in_(select(ClassroomGroup.classroom_id).distinct())
            )

        async def load(session: AsyncSession) -> GroupedClassroomPage:
            query = (
                select(Classroom)
                .join(Subject)
                .where(*conditions)
                .order_by(Subject.name, Classroom.subject_code, Classroom.number)
            )
            classrooms, total = await paginate(session, query, page, page_size)
            ids = [classroom.id for classroom in classrooms]
            counts = dict(
                (
                    await session.execute(
                        select(ClassroomGroup.classroom_id, func.count())
                        .where(ClassroomGroup.classroom_id.in_(ids))
                        .group_by(ClassroomGroup.classroom_id)
                    )
                ).all()
            )
            names = dict(
                (
                    await session.execute(
                        select(Subject.code, Subject.name).where(
                            Subject.code.in_({c.subject_code for c in classrooms})
                        )
                    )
                ).all()
            )
            return GroupedClassroomPage(
                items=[
                    GroupedClassroom(
                        code=classroom.subject_code,
                        name=names[classroom.subject_code],
                        number=classroom.number,
                        semester=classroom.semester,
                        schedule=classroom.schedule,
                        room=classroom.room,
                        professors=[p.name for p in classroom.professors],
                        groups=counts.get(classroom.id, 0),
                    )
                    for classroom in classrooms
                ],
                total=total,
                page=page,
                page_size=page_size,
            )

        return await self._db.read(load)

    async def get(self, code: str, semester: str, number: str) -> ClassroomGroups:
        async def load(session: AsyncSession) -> ClassroomGroups:
            classroom, name = await _classroom(session, code, semester, number)
            return await _groups(session, classroom, name)

        return await self._db.read(load)

    async def save(
        self, code: str, semester: str, number: str, body: GroupsInput
    ) -> ClassroomGroups:
        async def write(session: AsyncSession) -> ClassroomGroups:
            classroom, name = await _classroom(session, code, semester, number)
            # A lista inteira é trocada: quem edita vê e manda todos os grupos.
            await session.execute(
                delete(ClassroomGroup).where(
                    ClassroomGroup.classroom_id == classroom.id
                )
            )
            session.add_all(
                ClassroomGroup(
                    classroom_id=classroom.id,
                    position=position,
                    platform=group.platform,
                    url=group.url,
                    password=group.password,
                )
                for position, group in enumerate(body.groups)
            )
            await session.flush()
            return await _groups(session, classroom, name)

        return await self._db.write(write)


async def _classroom(
    session: AsyncSession, code: str, semester: str, number: str
) -> tuple[Classroom, str]:
    row = (
        await session.execute(
            select(Classroom, Subject.name)
            .join(Subject)
            .where(
                Classroom.subject_code == code,
                Classroom.semester == semester,
                Classroom.number == number,
            )
        )
    ).first()
    if row is None:
        raise HTTPException(404, "Turma não encontrada.")
    return row[0], row[1]


async def _groups(
    session: AsyncSession, classroom: Classroom, name: str
) -> ClassroomGroups:
    groups = await session.scalars(
        select(ClassroomGroup)
        .where(ClassroomGroup.classroom_id == classroom.id)
        .order_by(ClassroomGroup.position)
    )
    return ClassroomGroups(
        classroom=ClassroomRef(
            code=classroom.subject_code,
            name=name,
            number=classroom.number,
            semester=classroom.semester,
        ),
        groups=[
            SavedGroup(
                id=group.id,
                platform=group.platform,
                url=group.url,
                password=group.password,
            )
            for group in groups
        ],
    )


GroupServiceDep = Annotated[GroupService, Depends()]
