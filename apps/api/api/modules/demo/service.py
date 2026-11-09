"""Namespace sintético controlado exclusivamente pelo Owner no painel local."""

import random
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.main import DatabaseDep
from api.db.models import (
    Classroom,
    ClassroomGroup,
    ClassroomProfessor,
    DemoRecord,
    ForumPost,
    ForumReply,
    Professor,
    ProfessorReview,
    Report,
    SharedStatistics,
    Tutorial,
)
from api.modules.demo.community import community as _community
from api.modules.materials.service import delete_material

# Semestres passados das turmas fictícias com estatística; números que o SIGAA não usa.
_PAST = (("2025.1", "D1"), ("2025.2", "D2"))
# Outros docentes avaliados ao acaso, para o ranking ter com o que comparar.
_EXTRA_PROFESSORS = 40
_COMMENTS = (
    "Explica com calma e responde todas as dúvidas na aula.",
    "Provas difíceis, mas cobram o que foi dado. Faça as listas.",
    "Aulas bem organizadas, com slides e material no Aprender.",
    "Corrige rápido e dá retorno dos trabalhos.",
    "Matéria puxada; vale estudar em grupo desde o começo.",
    "Didática regular, mas é justo nas notas.",
    None,
    None,
)
_ATTENDANCE = ("cobra", "nao_cobra", "varia", None)


class DemoStatus(BaseModel):
    loaded: bool
    groups: int
    reviews: int
    classrooms: int
    materials: int = 0
    posts: int = 0
    tutorials: int = 0


def _statistics(rng: random.Random) -> list[dict[str, object]]:
    failed = rng.randint(5, 40)
    dropped = rng.randint(0, 12)
    return [
        {"situation": "aprovado", "percentage": 100 - failed - dropped},
        {"situation": "reprovado", "percentage": failed},
        {"situation": "trancado", "percentage": dropped},
    ]


class DemoService:
    def __init__(self, db: DatabaseDep) -> None:
        self._db = db

    async def status(self) -> DemoStatus:
        async def load(session: AsyncSession) -> DemoStatus:
            counts = dict(
                (
                    await session.execute(
                        select(DemoRecord.kind, func.count()).group_by(DemoRecord.kind)
                    )
                ).all()
            )
            return DemoStatus(
                loaded=bool(counts),
                groups=counts.get("group", 0),
                reviews=counts.get("review", 0),
                classrooms=counts.get("classroom", 0),
                materials=counts.get("material", 0),
                posts=counts.get("post", 0),
                tutorials=counts.get("tutorial", 0),
            )

        return await self._db.read(load)


async def _load(
    session: AsyncSession,
    everything: list[UUID],
    current_ids: list[UUID],
) -> None:
    await session.execute(text("SELECT pg_advisory_xact_lock(865942120)"))
    if await session.scalar(select(func.count()).select_from(DemoRecord)):
        return
    rng = random.Random()
    records: list[DemoRecord] = []

    def track(kind: str, record_id: UUID) -> None:
        records.append(DemoRecord(kind=kind, record_id=record_id))

    classrooms = [await session.get_one(Classroom, id_) for id_ in everything]
    current = [c for c in classrooms if c.id in set(current_ids)]

    # Grupos nas turmas atuais que ainda não têm nenhum.
    for classroom in current:
        if await session.scalar(
            select(ClassroomGroup.id).where(ClassroomGroup.classroom_id == classroom.id)
        ):
            continue
        for position, (platform, url, password) in enumerate(
            (
                (
                    "whatsapp",
                    f"https://chat.whatsapp.com/Demo{classroom.subject_code}",
                    None,
                ),
                (
                    "aprender3",
                    "https://aprender3.unb.br/course/view.php?id=0",
                    "demo123",
                ),
            )
        ):
            group = ClassroomGroup(
                classroom_id=classroom.id,
                position=position,
                platform=platform,
                url=url,
                password=password,
            )
            session.add(group)
            await session.flush()
            track("group", group.id)

    # Avaliações dos docentes das turmas do aluno e de outros ao acaso.
    own = {p.id: p for c in classrooms for p in c.professors if p.siape is not None}
    extra = await session.scalars(
        select(Professor)
        .where(Professor.siape.is_not(None), Professor.id.not_in(own))
        .order_by(func.random())
        .limit(_EXTRA_PROFESSORS)
    )
    subjects = {p.id: c.subject_code for c in classrooms for p in c.professors}
    for professor in [*own.values(), *extra]:
        base = rng.randint(35, 95)
        for _ in range(rng.randint(2, 6)):
            review = ProfessorReview(
                professor_id=professor.id,
                subject_code=subjects.get(professor.id),
                rating=max(0, min(100, base + rng.randint(-15, 15))),
                comment=rng.choice(_COMMENTS),
                attendance=rng.choice(_ATTENDANCE),
                token_hash="demo",
            )
            session.add(review)
            await session.flush()
            track("review", review.id)

    # Turmas passadas fictícias, com estatística compartilhada, das matérias atuais.
    for classroom in current:
        for semester, number in _PAST:
            past = Classroom(
                subject_code=classroom.subject_code,
                semester=semester,
                number=number,
                statistics=_statistics(rng),
            )
            session.add(past)
            await session.flush()
            track("classroom", past.id)
            session.add_all(
                ClassroomProfessor(classroom_id=past.id, professor_id=professor.id)
                for professor in classroom.professors
            )
            # apagar a turma apaga junto o compartilhamento
            session.add(SharedStatistics(classroom_id=past.id, sharer_key="demo"))
    await _community(session, current, rng, track)
    session.add_all(records)
    await session.flush()


async def clear_records(session: AsyncSession, *, lock: bool = True):
    rows = (await session.execute(select(DemoRecord.kind, DemoRecord.record_id))).all()
    classrooms = [record_id for kind, record_id in rows if kind == "classroom"]
    if classrooms:
        if lock:
            await session.execute(
                select(Classroom.id)
                .where(Classroom.id.in_(classrooms))
                .with_for_update()
            )
        groups = [record_id for kind, record_id in rows if kind == "group"]
        real_group = await session.scalar(
            select(ClassroomGroup.id)
            .where(
                ClassroomGroup.classroom_id.in_(classrooms),
                ClassroomGroup.id.not_in(groups),
            )
            .limit(1)
        )
        real_statistics = await session.scalar(
            select(SharedStatistics.classroom_id)
            .where(
                SharedStatistics.classroom_id.in_(classrooms),
                SharedStatistics.sharer_key != "demo",
            )
            .limit(1)
        )
        if real_group or real_statistics:
            raise HTTPException(
                409,
                "Uma turma sintética possui conteúdo real. A limpeza foi recusada para preservá-lo.",
            )
    posts = [record_id for kind, record_id in rows if kind == "post"]
    if posts:
        if lock:
            await session.execute(
                select(ForumPost.id).where(ForumPost.id.in_(posts)).with_for_update()
            )
        replies = [record_id for kind, record_id in rows if kind == "reply"]
        real_reply = await session.scalar(
            select(ForumReply.id)
            .where(
                ForumReply.post_id.in_(posts),
                ForumReply.id.not_in(replies),
            )
            .limit(1)
        )
        if real_reply:
            raise HTTPException(
                409,
                "Uma publicação de demonstração recebeu respostas reais. Revise essas respostas antes de limpar a demonstração.",
            )
    return rows


async def _clear(session: AsyncSession) -> None:
    await session.execute(text("SELECT pg_advisory_xact_lock(865942120)"))
    rows = await clear_records(session)
    tables = {
        "group": ClassroomGroup,
        "review": ProfessorReview,
        "classroom": Classroom,
    }
    tables.update({"post": ForumPost, "tutorial": Tutorial, "report": Report})
    for kind, model in tables.items():
        ids = [record_id for row_kind, record_id in rows if row_kind == kind]
        if ids:
            await session.execute(delete(model).where(model.id.in_(ids)))
    for kind, record_id in rows:
        if kind == "material":
            await delete_material(session, record_id)
    await session.execute(delete(DemoRecord))
