from typing import Literal

from sqlalchemy import ColumnElement, Select, func, literal_column, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, load_only

from api.db.models import (
    Classroom,
    ClassroomProfessor,
    Professor,
    ProfessorReview,
    Subject,
)
from api.db.search import contains_all_terms, lookup_sql

ProfessorOrder = Literal["name", "best", "worst", "reviews"]


def _taught(subject: str) -> ColumnElement[bool]:
    """Docentes que deram a matéria (pelo código ou nome): no catálogo ou numa turma."""
    codes = select(Subject.code).where(
        or_(Subject.code == subject.upper(), contains_all_terms(Subject.name, subject))
    )
    seen = aliased(Professor)
    in_classrooms = (
        select(lookup_sql(seen.name))
        .join(ClassroomProfessor, ClassroomProfessor.professor_id == seen.id)
        .join(Classroom, Classroom.id == ClassroomProfessor.classroom_id)
        .where(Classroom.subject_code.in_(codes))
    )
    disciplines = (
        select(1)
        .select_from(func.jsonb_array_elements(Professor.disciplines).alias("item"))
        .where(literal_column("item.value ->> 'code'").in_(codes))
    )
    return or_(lookup_sql(Professor.name).in_(in_classrooms), disciplines.exists())


class ProfessorRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list(
        self,
        q: str | None,
        unit_id: int | None,
        semester: str | None,
        page: int,
        page_size: int,
        *,
        subject: str | None = None,
        order: ProfessorOrder = "name",
        rated: bool = False,
    ) -> tuple[list[tuple[Professor, int | None, float | None]], int]:
        # Os vistos só nas turmas, sem siape, não têm perfil público.
        conditions = [Professor.siape.is_not(None)]
        if q is not None:
            conditions.append(contains_all_terms(Professor.name, q))
        if unit_id is not None:
            conditions.append(Professor.unit_id == unit_id)
        if semester is not None:
            conditions.append(Professor.disciplines.contains([{"semester": semester}]))
        if subject is not None:
            conditions.append(_taught(subject))
        ratings = (
            select(
                ProfessorReview.professor_id,
                func.count().label("count"),
                func.round(func.avg(ProfessorReview.rating), 1).label("average"),
            )
            .group_by(ProfessorReview.professor_id)
            .subquery()
        )
        if rated:
            conditions.append(ratings.c.count.is_not(None))
        # Sem avaliação, o docente conta como nota zero nos rankings.
        score = func.coalesce(ratings.c.average, 0)
        sort = {
            "name": (),
            "best": (score.desc(), ratings.c.count.desc().nulls_last()),
            "worst": (score.asc(), ratings.c.count.desc().nulls_last()),
            "reviews": (ratings.c.count.desc().nulls_last(), score.desc()),
        }[order]
        query: Select = (
            select(Professor, ratings.c.count, ratings.c.average)
            .outerjoin(ratings, ratings.c.professor_id == Professor.id)
            .options(
                load_only(
                    Professor.siape,
                    Professor.name,
                    Professor.unit_id,
                    Professor.photo,
                )
            )
            .where(*conditions)
            .order_by(*sort, Professor.name, Professor.siape)
        )
        total = await self._session.scalar(
            select(func.count()).select_from(query.order_by(None).subquery())
        )
        total = total or 0
        if (page - 1) * page_size >= total:
            return [], total
        rows = await self._session.execute(
            query.offset((page - 1) * page_size).limit(page_size)
        )
        return [
            (professor, count, average) for professor, count, average in rows
        ], total

    async def get(self, siape: int) -> Professor | None:
        return await self._session.scalar(
            select(Professor).where(Professor.siape == siape)
        )
