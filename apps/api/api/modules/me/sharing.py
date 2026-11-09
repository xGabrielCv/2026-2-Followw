"""Liberar os índices das turmas encerradas do aluno, sem ligar a turma a quem liberou."""

import asyncio
from datetime import UTC, datetime

import httpx
from pydantic import BaseModel
from sigaa_client import SigaaError
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from api.account import Account
from api.anonymous import anonymous_key
from api.db.main import Database
from api.db.models import Classroom, SharedStatistics
from api.modules.classrooms.repository import ClassroomRepository
from api.modules.classrooms.service import ClassroomService
from api.sigaa import SigaaConnection


class SharingInput(BaseModel):
    shared: bool


class SharingStatus(BaseModel):
    shared: bool
    # Turmas do aluno com índice liberado agora.
    classrooms: int
    # Há turmas encerradas sem índice ainda: um job os busca e libera em seguida.
    pending: bool = False


def _scope(classroom_id: object) -> str:
    return f"statistics:{classroom_id}"


async def set_sharing(
    account: Account, db: Database, shared: bool, author: str
) -> SharingStatus:
    turmas = await ClassroomService(account, db).list_turmas("all")
    past = [turma.row.id for turma in turmas if not turma.current]
    missing = [
        turma.row.id
        for turma in turmas
        if not turma.current and turma.row.statistics_synced_at is None
    ]
    pending = False
    if shared and missing:
        # Credenciais nunca saem para filas persistentes, nem mesmo cifradas.
        try:
            async with asyncio.timeout(15):
                await fetch_and_share_statistics(account.connection, db, author)
        except TimeoutError, SigaaError, httpx.HTTPError:
            pending = True
    count = await db.write(lambda session: _share(session, author, past, shared))
    return SharingStatus(
        shared=shared,
        classrooms=count if shared else 0,
        pending=pending,
    )


async def fetch_and_share_statistics(
    connection: SigaaConnection, db: Database, author: str | None
) -> None:
    """Job: busca os índices das turmas encerradas que faltam e os libera."""
    account = Account(connection)
    turmas = await ClassroomService(account, db).list_turmas("all")
    client = await connection.client()
    past = []
    for turma in turmas:
        if turma.current:
            continue
        past.append(turma.row.id)
        if turma.row.statistics_synced_at is not None:
            continue
        shares = await client.classrooms.get_classroom_statistics(turma.front_end_id)
        await db.write(
            lambda session, turma=turma, shares=shares: ClassroomRepository(
                session
            ).save_statistics(turma.row.id, shares, datetime.now(UTC))
        )
    await db.write(lambda session: _share(session, author, past, shared=True))


async def _share(
    session: AsyncSession, author: str | None, classrooms: list, shared: bool
) -> int:
    """Grava (ou apaga) a liberação de cada turma com índice; devolve quantas."""
    if not classrooms or author is None:
        return 0
    with_statistics = list(
        await session.scalars(
            select(Classroom.id).where(
                Classroom.id.in_(classrooms),
                func.jsonb_typeof(Classroom.statistics) == "array",
                Classroom.statistics != [],
            )
        )
    )
    keys = [(id_, anonymous_key(author, _scope(id_))) for id_ in with_statistics]
    if shared and keys:
        await session.execute(
            insert(SharedStatistics)
            .values([{"classroom_id": id_, "sharer_key": key} for id_, key in keys])
            .on_conflict_do_nothing()
        )
    # Só as linhas deste aluno: outro que liberou a mesma turma continua valendo.
    elif not shared:
        for id_ in classrooms:
            await session.execute(
                delete(SharedStatistics).where(
                    SharedStatistics.classroom_id == id_,
                    SharedStatistics.sharer_key == anonymous_key(author, _scope(id_)),
                )
            )
    return len(keys)
