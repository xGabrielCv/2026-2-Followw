from collections.abc import Sequence
from typing import NamedTuple

from fastapi import HTTPException
from sigaa_client import Grade, UserLevel
from sigaa_client import UserProfile as SigaaProfile
from sqlalchemy.ext.asyncio import AsyncSession

from api import academic_calendar
from api.academic_calendar import parse_semester
from api.account import Account
from api.db.enums import ClassroomStatus
from api.db.main import Database
from api.modules.classrooms.repository import ClassroomRepository
from api.modules.me.profile import enrollment
from api.modules.public_subjects.repository import SubjectCatalogRepository
from api.modules.recommendations.ranking import (
    Component,
    Recommendation,
    rank,
)
from api.modules.recommendations.repository import RecommendationRepository
from api.schemas import normalize

# Trancamento ou indeferimento não deixa menção pendente: a tentativa não conta.
_WITHOUT_ATTEMPT = {
    ClassroomStatus.TRANCADO,
    ClassroomStatus.DENIED,
}


class HistoryItem(NamedTuple):
    """Uma turma do histórico, como o navegador a guardou da lista de turmas."""

    code: str
    semester: str
    grade: Grade | None
    status: ClassroomStatus | None


class Ranking(NamedTuple):
    semester: str | None
    items: list[Recommendation]
    curriculum: dict[str, Component]


class RecommendationService:
    def __init__(self, account: Account, db: Database) -> None:
        self._account = account
        self._db = db

    async def recommend(
        self,
        completed: frozenset[str] = frozenset(),
        history: Sequence[HistoryItem] = (),
    ) -> Ranking:
        """As matérias da oferta mais recente, ordenadas para o próximo semestre do aluno.

        O histórico vem do navegador, que já o tem: o servidor não guarda nem relê as menções.
        """
        profile = await self._account.profile()
        if profile.level != UserLevel.GRADUACAO:
            raise HTTPException(
                422, "Recomendações disponíveis somente para graduação."
            )
        return await self._db.write(
            lambda session: _ranking(session, profile, completed, history)
        )


async def _ranking(
    session: AsyncSession,
    profile: SigaaProfile,
    completed: frozenset[str],
    history: Sequence[HistoryItem],
) -> Ranking:
    found = await enrollment(session, profile)
    if found.curriculum_id is None:
        raise HTTPException(422, "Matriz curricular do aluno não identificada.")
    curriculum = await RecommendationRepository(session).components(found.curriculum_id)
    reference = await ClassroomRepository(session).offer_semester()
    items = await _rank(
        session,
        curriculum,
        found.course.unit_id if found.course else None,
        reference,
        _until(history, reference),
        completed,
    )
    return Ranking(reference, items, curriculum)


def _until(history: Sequence[HistoryItem], reference: str | None) -> list[HistoryItem]:
    limit = parse_semester(reference) if reference else None
    if limit is None:
        return []
    return [
        item
        for item in history
        if (term := parse_semester(item.semester)) and term <= limit
    ]


def _in_progress(item: HistoryItem) -> bool:
    """Cursando, ou encerrada com a menção ainda por consolidar."""
    return item.status == ClassroomStatus.CURSANDO or (
        item.status == ClassroomStatus.CONCLUIDO
        and item.grade is None
        and not academic_calendar.grades_closed(item.semester)
    )


async def _rank(
    session: AsyncSession,
    curriculum: dict[str, Component],
    unit_id: int | None,
    reference: str | None,
    history: list[HistoryItem],
    manual: frozenset[str] = frozenset(),
) -> list[Recommendation]:
    if not curriculum:
        return []
    completed = {
        normalize(item.code) for item in history if item.grade and item.grade.approved
    }
    # As que o aluno marcou como concluídas no fluxo (ex.: código antigo sem equivalência).
    completed |= {normalize(code) for code in manual}
    enrolled = {normalize(item.code) for item in history if _in_progress(item)}
    # Fora da matriz é módulo livre: só os componentes dela importam.
    offered = curriculum.keys() & {
        normalize(code)
        for code in await ClassroomRepository(session).offered_subject_codes(reference)
    }
    subjects = RecommendationRepository(session)
    catalog = await subjects.catalog(set(curriculum))
    requirements = {
        normalize(code)
        for subject in catalog.values()
        for rules in (subject.prerequisites, subject.corequisites)
        for group in rules or []
        for code in group
    }
    catalog.update(await subjects.catalog(requirements - catalog.keys()))
    # `X ≡ (A)` com X cursada vale A, ainda que A não cite X de volta.
    reverse = await SubjectCatalogRepository(session).reverse_equivalences(
        set(curriculum)
    )
    return rank(
        catalog=catalog,
        reverse_equivalences=reverse,
        offered=offered & catalog.keys(),
        curriculum=curriculum,
        completed=completed,
        enrolled=enrolled - completed,
        unresolved={
            normalize(item.code)
            for item in history
            if item.grade is None and item.status not in _WITHOUT_ATTEMPT
        },
        unit_id=unit_id,
    )
