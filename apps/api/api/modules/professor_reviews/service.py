"""Avaliações anônimas de docentes: nota de 0 a 100, comentário e se cobram chamada.

Nada de quem avaliou é gravado. Quem cria recebe um segredo aleatório (só o hash fica no
banco) que permite ao próprio navegador editar ou apagar a avaliação depois.
"""

import hashlib
import hmac
import secrets
from typing import Annotated, Literal
from uuid import UUID

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.context import set_context
from api.db.main import DatabaseDep
from api.db.models import Professor, ProfessorReview, Subject
from api.schemas import SubjectReference

Attendance = Literal["cobra", "nao_cobra", "varia"]
SubjectCode = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, to_upper=True, pattern=r"^[A-Za-z0-9]{3,16}$"
    ),
]
# Comentários mais recentes no perfil; a média usa todas.
MAX_LISTED = 200


class ReviewCriteria(BaseModel):
    model_config = ConfigDict(extra="forbid")
    clarity: int | None = Field(default=None, ge=1, le=5)
    organization: int | None = Field(default=None, ge=1, le=5)
    assessment: int | None = Field(default=None, ge=1, le=5)


class ReviewInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    semester: str | None = Field(default=None, pattern=r"^20[0-9]{2}\.[12]$")
    criteria: ReviewCriteria | None = None
    rating: int = Field(ge=0, le=100)
    comment: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)] | None
    ) = None
    attendance: Attendance | None = None
    subject: SubjectCode | None = Field(
        default=None, description="Matéria em que o aluno teve aula com o docente."
    )


class NewReview(ReviewInput):
    siape: int = Field(gt=0, le=2**31 - 1)


class Rating(BaseModel):
    count: int
    average: float = Field(description="Média das notas, de 0 a 100.")


class RatingSummary(Rating):
    attendance: dict[Attendance, int]


class Review(BaseModel):
    id: UUID
    rating: int
    semester: str | None
    criteria: ReviewCriteria | None
    comment: str | None
    attendance: Attendance | None
    subject: SubjectReference | None
    # Só mês e ano: o dia ajudaria a descobrir quem avaliou.
    month: str


class CreatedReview(BaseModel):
    review: Review
    token: str = Field(description="Guarde no navegador para editar ou apagar depois.")


class ProfessorReviews(BaseModel):
    summary: RatingSummary | None
    reviews: list[Review]
    total: int
    page: int
    page_size: int


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _review(review: ProfessorReview, names: dict[str, str]) -> Review:
    code = review.subject_code
    return Review(
        id=review.id,
        rating=review.rating,
        semester=review.semester,
        criteria=ReviewCriteria.model_validate(review.criteria)
        if review.criteria
        else None,
        comment=review.comment or None,
        attendance=review.attendance,
        subject=SubjectReference(code=code, name=names.get(code, code))
        if code
        else None,
        month=review.created_at.strftime("%Y-%m"),
    )


_ATTENDANCE: tuple[Attendance, ...] = ("cobra", "nao_cobra", "varia")


async def ratings_by_siape(
    session: AsyncSession, siapes: set[int]
) -> dict[int, RatingSummary]:
    if not siapes:
        return {}
    rows = await session.execute(
        select(
            Professor.siape,
            func.count(),
            func.round(func.avg(ProfessorReview.rating), 1),
            *(
                func.count().filter(ProfessorReview.attendance == kind)
                for kind in _ATTENDANCE
            ),
        )
        .join(Professor, Professor.id == ProfessorReview.professor_id)
        .where(Professor.siape.in_(siapes))
        .group_by(Professor.siape)
    )
    return {
        siape: RatingSummary(
            count=count,
            average=float(average),
            attendance=dict(zip(_ATTENDANCE, attendance, strict=True)),
        )
        for siape, count, average, *attendance in rows
    }


async def _names(session: AsyncSession, codes: set[str | None]) -> dict[str, str]:
    wanted = {code for code in codes if code}
    if not wanted:
        return {}
    rows = await session.execute(
        select(Subject.code, Subject.name).where(Subject.code.in_(wanted))
    )
    return dict(rows.all())


async def _professor_id(session: AsyncSession, siape: int) -> UUID:
    professor_id = await session.scalar(
        select(Professor.id).where(Professor.siape == siape)
    )
    if professor_id is None:
        raise HTTPException(404, "Docente não encontrado.")
    return professor_id


async def _own(session: AsyncSession, review_id: UUID, token: str) -> ProfessorReview:
    review = await session.get(ProfessorReview, review_id)
    # Sem o segredo certo, nem diz se a avaliação existe.
    if review is None or not hmac.compare_digest(review.token_hash, _hash(token)):
        raise HTTPException(404, "Avaliação não encontrada.")
    return review


class ReviewService:
    def __init__(self, db: DatabaseDep) -> None:
        self._db = db

    async def _check_duplicate(
        self,
        session: AsyncSession,
        professor_id: UUID,
        body: ReviewInput,
        excluding: UUID | None = None,
    ) -> None:
        if not body.comment or len(body.comment) < 20:
            return
        await session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:scope))"),
            {"scope": f"reviews:{professor_id}"},
        )
        query = (
            select(ProfessorReview)
            .where(
                ProfessorReview.professor_id == professor_id,
                ProfessorReview.subject_code.is_not_distinct_from(body.subject),
                ProfessorReview.semester.is_not_distinct_from(body.semester),
            )
            .order_by(ProfessorReview.created_at.desc())
            .limit(2000)
        )
        if excluding:
            query = query.where(ProfessorReview.id != excluding)
        normalized = " ".join(body.comment.casefold().split())
        for item in await session.scalars(query):
            if item.comment and " ".join(item.comment.casefold().split()) == normalized:
                raise HTTPException(
                    409,
                    "Este comentário já foi publicado para este docente, matéria e semestre. Edite sua avaliação existente.",
                )

    async def create(self, body: NewReview) -> CreatedReview:
        token = secrets.token_urlsafe(32)
        set_context(review_hash=_hash(token))

        async def write(session: AsyncSession) -> Review:
            professor_id = await _professor_id(session, body.siape)
            await self._check_duplicate(session, professor_id, body)
            review = ProfessorReview(
                professor_id=professor_id,
                semester=body.semester,
                criteria=body.criteria.model_dump(exclude_none=True)
                if body.criteria
                else None,
                subject_code=body.subject,
                rating=body.rating,
                comment=body.comment or None,
                attendance=body.attendance,
                token_hash=_hash(token),
            )
            session.add(review)
            await session.flush()
            await session.refresh(review)
            return _review(review, await _names(session, {body.subject}))

        return CreatedReview(review=await self._db.write(write), token=token)

    async def update(self, review_id: UUID, token: str, body: ReviewInput) -> Review:
        set_context(review_hash=_hash(token))

        async def write(session: AsyncSession) -> Review:
            review = await _own(session, review_id, token)
            await self._check_duplicate(session, review.professor_id, body, review_id)
            review.semester = body.semester
            review.criteria = (
                body.criteria.model_dump(exclude_none=True) if body.criteria else None
            )
            review.subject_code = body.subject
            review.rating = body.rating
            review.comment = body.comment or None
            review.attendance = body.attendance
            await session.flush()
            return _review(review, await _names(session, {body.subject}))

        return await self._db.write(write)

    async def delete(self, review_id: UUID, token: str) -> None:
        set_context(review_hash=_hash(token))

        async def write(session: AsyncSession) -> None:
            await session.delete(await _own(session, review_id, token))

        await self._db.write(write)

    async def professor(
        self,
        siape: int,
        *,
        subject: str | None = None,
        semester: str | None = None,
        order: Literal["recent", "best", "worst"] = "recent",
        page: int = 1,
        page_size: int = 20,
    ) -> ProfessorReviews:
        async def load(session: AsyncSession) -> ProfessorReviews:
            professor_id = await _professor_id(session, siape)
            query = select(ProfessorReview).where(
                ProfessorReview.professor_id == professor_id
            )
            if subject:
                query = query.where(ProfessorReview.subject_code == subject.upper())
            if semester:
                query = query.where(ProfessorReview.semester == semester)
            total = await session.scalar(
                select(func.count()).select_from(query.subquery())
            )
            sort = [ProfessorReview.created_at.desc(), ProfessorReview.id]
            if order != "recent":
                sort.insert(
                    0,
                    ProfessorReview.rating.desc()
                    if order == "best"
                    else ProfessorReview.rating.asc(),
                )
            reviews = list(
                await session.scalars(
                    query.order_by(*sort)
                    .offset((page - 1) * page_size)
                    .limit(page_size)
                )
            )
            names = await _names(session, {review.subject_code for review in reviews})
            summary = (await ratings_by_siape(session, {siape})).get(siape)
            return ProfessorReviews(
                summary=summary,
                reviews=[_review(review, names) for review in reviews[:MAX_LISTED]],
                total=total or 0,
                page=page,
                page_size=page_size,
            )

        return await self._db.read(load)

    async def ratings(self, siapes: set[int]) -> dict[int, RatingSummary]:
        return await self._db.read(lambda session: ratings_by_siape(session, siapes))


ReviewServiceDep = Annotated[ReviewService, Depends()]
