"""Índices de aprovação, reprovação e trancamento por matéria e por docente.

Vêm das estatísticas das turmas de alunos do Followw que escolheram compartilhá-las no perfil (o
SIGAA só mostra a de quem participou da turma): a cobertura cresce com o uso e cada índice diz em quantas turmas se
baseia. Cada turma pesa igual, como nas estatísticas anteriores.
"""

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException
from pydantic import BaseModel
from sigaa_client import lookup_key
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.main import DatabaseDep
from api.db.models import Classroom, ClassroomProfessor, Professor, Subject
from api.db.search import lookup_sql
from api.modules.public_subjects.sharing import shared_statistics

_APPROVED = {"aprovado", "aprovado_por_nota"}
_FAILED = {
    "reprovado",
    "reprovado_por_faltas",
    "reprovado_por_media_e_por_faltas",
    "reprovado_por_nota",
    "reprovado_por_nota_e_faltas",
}
_DROPPED = {"trancado"}


class OutcomeRates(BaseModel):
    """Médias por turma, em % dos discentes."""

    classrooms: int
    approved: float
    failed: float
    dropped: float


class ProfessorOutcome(BaseModel):
    name: str
    siape: int | None
    # Nesta matéria e em todas as turmas do docente com dados.
    subject: OutcomeRates | None
    overall: OutcomeRates | None


class SubjectOutcomes(BaseModel):
    subject: OutcomeRates | None
    professors: list[ProfessorOutcome]


class SubjectRate(BaseModel):
    code: str
    name: str
    rates: OutcomeRates


class ProfessorOutcomes(BaseModel):
    overall: OutcomeRates | None
    subjects: list[SubjectRate]


@dataclass
class _Sample:
    code: str
    statistics: list[dict[str, object]]
    professors: set[str] = field(default_factory=set)


def outcome_rates(samples: Iterable[_Sample]) -> OutcomeRates | None:
    shares = [sample.statistics for sample in samples]
    if not shares:
        return None

    def average(situations: set[str]) -> float:
        total = sum(
            float(str(share["percentage"]))
            for statistics in shares
            for share in statistics
            if share.get("situation") in situations
        )
        return round(total / len(shares), 1)

    return OutcomeRates(
        classrooms=len(shares),
        approved=average(_APPROVED),
        failed=average(_FAILED),
        dropped=average(_DROPPED),
    )


async def _samples(session: AsyncSession, *conditions) -> list[_Sample]:
    """As turmas com estatística que atendem `conditions`, com as chaves dos docentes."""
    rows = await session.execute(
        select(
            Classroom.id, Classroom.subject_code, Classroom.statistics, Professor.name
        )
        .outerjoin(ClassroomProfessor, ClassroomProfessor.classroom_id == Classroom.id)
        .outerjoin(Professor, Professor.id == ClassroomProfessor.professor_id)
        .where(
            # `None` vira o null do JSON na coluna: só valem listas com fatias
            func.jsonb_typeof(Classroom.statistics) == "array",
            Classroom.statistics != [],
            shared_statistics(),
            *conditions,
        )
    )
    samples: dict[UUID, _Sample] = {}
    for id_, code, statistics, name in rows:
        sample = samples.setdefault(id_, _Sample(code, statistics or []))
        if name:
            sample.professors.add(lookup_key(name))
    return list(samples.values())


async def _catalog(session: AsyncSession, keys: set[str]) -> dict[str, tuple[str, int]]:
    """Nome e SIAPE do catálogo para cada chave de nome."""
    if not keys:
        return {}
    rows = await session.execute(
        select(Professor.name, Professor.siape).where(
            Professor.siape.is_not(None), lookup_sql(Professor.name).in_(keys)
        )
    )
    return {lookup_key(name): (name, siape) for name, siape in rows}


async def _professor_samples(session: AsyncSession, keys: set[str]) -> list[_Sample]:
    if not keys:
        return []
    classrooms = (
        select(ClassroomProfessor.classroom_id)
        .join(Professor, Professor.id == ClassroomProfessor.professor_id)
        .where(lookup_sql(Professor.name).in_(keys))
    )
    return await _samples(session, Classroom.id.in_(classrooms))


class OutcomeService:
    def __init__(self, db: DatabaseDep) -> None:
        self._db = db

    async def subject(self, code: str) -> SubjectOutcomes:
        """A matéria e cada docente que já a ofertou, com o índice nela e o geral."""

        async def load(session: AsyncSession) -> SubjectOutcomes:
            if await session.get(Subject, code) is None:
                raise HTTPException(404, "Matéria não encontrada.")
            subject = await _samples(session, Classroom.subject_code == code)
            names = await session.scalars(
                select(Professor.name)
                .join(
                    ClassroomProfessor, ClassroomProfessor.professor_id == Professor.id
                )
                .join(Classroom, Classroom.id == ClassroomProfessor.classroom_id)
                .where(Classroom.subject_code == code)
                .distinct()
            )
            shown = {lookup_key(name): name for name in names}
            catalog = await _catalog(session, set(shown))
            overall = await _professor_samples(session, set(shown))
            professors = [
                ProfessorOutcome(
                    name=catalog.get(key, (name, None))[0],
                    siape=catalog.get(key, (name, None))[1],
                    subject=outcome_rates(s for s in subject if key in s.professors),
                    overall=outcome_rates(s for s in overall if key in s.professors),
                )
                for key, name in sorted(shown.items())
            ]
            return SubjectOutcomes(
                subject=outcome_rates(subject), professors=professors
            )

        return await self._db.read(load)

    async def professor(self, siape: int) -> ProfessorOutcomes:
        """O índice geral do docente e o de cada matéria que ele deu, com dados."""

        async def load(session: AsyncSession) -> ProfessorOutcomes:
            name = await session.scalar(
                select(Professor.name).where(Professor.siape == siape)
            )
            if name is None:
                raise HTTPException(404, "Docente não encontrado.")
            samples = await _professor_samples(session, {lookup_key(name)})
            by_subject: dict[str, list[_Sample]] = defaultdict(list)
            for sample in samples:
                by_subject[sample.code].append(sample)
            names = dict(
                (
                    await session.execute(
                        select(Subject.code, Subject.name).where(
                            Subject.code.in_(by_subject)
                        )
                    )
                ).all()
            )
            subjects = [
                SubjectRate(code=code, name=names.get(code, code), rates=rates)
                for code, group in sorted(by_subject.items())
                if (rates := outcome_rates(group))
            ]
            return ProfessorOutcomes(overall=outcome_rates(samples), subjects=subjects)

        return await self._db.read(load)


OutcomeServiceDep = Annotated[OutcomeService, Depends()]


class Comparison(BaseModel):
    """Índices gerais para o aluno se comparar no próprio aparelho: o histórico dele não vem aqui."""

    unb: OutcomeRates | None
    course: OutcomeRates | None
    # Matérias com dados: as do curso pedido, ou as da UnB inteira sem curso.
    subjects: list[SubjectRate]


async def comparison(session: AsyncSession, course_id: int | None) -> Comparison:
    from api.db.models import Curriculum, CurriculumComponent

    samples = await _samples(session)
    course_codes: set[str] | None = None
    if course_id is not None:
        course_codes = set(
            await session.scalars(
                select(CurriculumComponent.subject_code)
                .join(Curriculum, Curriculum.id == CurriculumComponent.curriculum_id)
                .where(Curriculum.course_id == course_id)
            )
        )
    in_scope = [
        sample
        for sample in samples
        if course_codes is None or sample.code in course_codes
    ]
    by_code: dict[str, list[_Sample]] = defaultdict(list)
    for sample in in_scope:
        by_code[sample.code].append(sample)
    names = dict(
        (
            await session.execute(
                select(Subject.code, Subject.name).where(Subject.code.in_(by_code))
            )
        ).all()
    )
    subjects = [
        SubjectRate(code=code, name=names.get(code, code), rates=rates)
        for code, group in by_code.items()
        if (rates := outcome_rates(group)) is not None
    ]
    subjects.sort(key=lambda item: (-item.rates.failed, item.code))
    return Comparison(
        unb=outcome_rates(samples),
        course=outcome_rates(in_scope) if course_codes is not None else None,
        subjects=subjects[:300],
    )
