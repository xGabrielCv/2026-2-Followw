import logging
import uuid
from pathlib import Path

from sigaa_client import lookup_key
from sqlalchemy import select, tuple_, update
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import Classroom, Subject
from api.db.professors import (
    SeenProfessor,
    save_classroom_professors,
    save_professors,
)
from api.db.seed import DATA_DIR, read_csv, upsert
from api.logger import event

CLASSROOMS_CSV = DATA_DIR / "classrooms.csv"
KEY = ("subject_code", "number", "semester")
# Horário e sala das gravadas são do sync, que replaneja as aulas.
FIELDS = ("vacancies", "occupied", "offer_active")
_LOOKUP_BATCH = 1000

type ClassroomKey = tuple[str, str, str]


def _key(classroom: Classroom) -> ClassroomKey:
    return classroom.subject_code, classroom.number, classroom.semester


def read_classrooms(
    path: Path = CLASSROOMS_CSV,
) -> list[tuple[Classroom, list[str]]]:
    """As turmas do CSV (`subject_code,number,semester,schedule,room,vacancies,occupied,professors`) e os nomes dos docentes."""
    names: dict[ClassroomKey, list[str]] = {}

    def parse(row: dict[str, str]) -> Classroom:
        classroom = Classroom(
            subject_code=row["subject_code"].strip().upper(),
            number=row["number"].strip(),
            semester=row["semester"].strip(),
            schedule=row["schedule"].strip() or None,
            room=row["room"].strip() or None,
            vacancies=int(row["vacancies"]) if row["vacancies"] else None,
            occupied=int(row["occupied"]) if row["occupied"] else None,
            offer_active=True,
        )
        names[_key(classroom)] = [
            name.strip() for name in row["professors"].split(";") if name.strip()
        ]
        return classroom

    classrooms = read_csv(path, parse, unique=(KEY,))
    return [(classroom, names[_key(classroom)]) for classroom in classrooms]


async def seed_classrooms(session: AsyncSession, path: Path = CLASSROOMS_CSV) -> None:
    subjects = set(await session.scalars(select(Subject.code)))
    read = read_classrooms(path)
    offer = [(c, names) for c, names in read if c.subject_code in subjects]
    if skipped := len(read) - len(offer):
        event("seed.classrooms_skipped", level=logging.WARNING, skipped_count=skipped)
    await upsert(session, Classroom, [c for c, _ in offer], KEY, FIELDS)
    if offer:
        await prune_public_classrooms(session, min(c.semester for c, _ in offer))

    # Turma sem docente no CSV fica com os da lista de participantes.
    named = {_key(c): names for c, names in offer if names}
    if not named:
        return
    columns = (Classroom.subject_code, Classroom.number, Classroom.semester)
    keys = list(named)
    ids: dict[ClassroomKey, uuid.UUID] = {}
    # Em lotes: um IN com todas as turmas estoura a pilha do Postgres.
    for start in range(0, len(keys), _LOOKUP_BATCH):
        rows = await session.execute(
            select(Classroom.id, *columns).where(
                tuple_(*columns).in_(keys[start : start + _LOOKUP_BATCH])
            )
        )
        ids.update(
            ((code, number, semester), id_) for id_, code, number, semester in rows
        )
    unique = {lookup_key(name): name for names in named.values() for name in names}
    seen = [SeenProfessor(name=name) for name in unique.values()]
    professors = dict(zip(unique, await save_professors(session, seen), strict=True))
    await save_classroom_professors(
        session,
        {
            ids[key]: [professors[lookup_key(name)] for name in names]
            for key, names in named.items()
        },
    )


async def prune_public_classrooms(session: AsyncSession, oldest: str) -> None:
    """Encerra ofertas antigas sem apagar turmas, estatísticas ou referências comunitárias."""
    result = await session.execute(
        update(Classroom)
        .where(
            Classroom.semester < oldest,
            Classroom.offer_active.is_(True),
        )
        .values(offer_active=False)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount:
        event("seed.classrooms_pruned", pruned_count=result.rowcount)
