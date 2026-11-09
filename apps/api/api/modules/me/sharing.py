"""Liberar os índices das turmas encerradas do aluno, sem ligar a turma a quem liberou."""

import asyncio
import secrets
import uuid
from datetime import UTC, datetime
from typing import Annotated

import httpx
from pydantic import BaseModel, Field, StringConstraints
from sigaa_client import SigaaError
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from api.account import Account
from api.anonymous import resource_key
from api.db.main import Database
from api.db.models import Classroom, SharedStatistics
from api.modules.classrooms.repository import ClassroomRepository
from api.modules.classrooms.service import ClassroomService
from api.sigaa import SigaaConnection


class SharingInput(BaseModel):
    shared: bool
    # Chaves que o navegador guardou de liberações anteriores (turma -> chave): servem para não contar
    # a mesma turma duas vezes e para desfazer só a sua liberação.
    keys: dict[
        uuid.UUID, Annotated[str, StringConstraints(min_length=32, max_length=64)]
    ] = Field(default_factory=dict, max_length=500)


class SharingStatus(BaseModel):
    shared: bool
    # Turmas do aluno com índice liberado agora.
    classrooms: int
    # Há turmas encerradas sem índice ainda: um job os busca e libera em seguida.
    pending: bool = False
    # Chaves NOVAS, sorteadas agora, uma por turma liberada: o navegador as guarda (o servidor só guarda
    # o verificador) e as manda de volta para desfazer. Nada liga uma turma à outra.
    keys: dict[uuid.UUID, str] = Field(default_factory=dict)


def _scope(classroom_id: object) -> str:
    return f"statistics:{classroom_id}"  # só para linhas legadas (migração)


async def set_sharing(
    account: Account, db: Database, shared: bool, keys: dict[uuid.UUID, str]
) -> SharingStatus:
    turmas = await ClassroomService(account, db).list_turmas("all")
    past = [turma.row.id for turma in turmas if not turma.current]
    missing = [
        turma.row.id
        for turma in turmas
        if not turma.current and turma.row.statistics_synced_at is None
    ]
    pending = False
    minted: dict[uuid.UUID, str] = {}
    if shared and missing:
        # Credenciais nunca saem para filas persistentes, nem mesmo cifradas.
        try:
            async with asyncio.timeout(15):
                minted.update(
                    await fetch_and_share_statistics(account.connection, db, keys)
                )
        except TimeoutError, SigaaError, httpx.HTTPError:
            pending = True
    count, more = await db.write(lambda session: _share(session, keys, past, shared))
    minted.update(more)
    return SharingStatus(
        shared=shared,
        classrooms=count if shared else 0,
        pending=pending,
        keys=minted if shared else {},
    )


async def fetch_and_share_statistics(
    connection: SigaaConnection, db: Database, keys: dict[uuid.UUID, str]
) -> dict[uuid.UUID, str]:
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
    _, minted = await db.write(lambda session: _share(session, keys, past, shared=True))
    return minted


async def _share(
    session: AsyncSession,
    keys_in: dict[uuid.UUID, str],
    classrooms: list,
    shared: bool,
) -> tuple[int, dict[uuid.UUID, str]]:
    """Grava (ou apaga) a liberação de cada turma com índice; devolve quantas."""
    if not classrooms:
        return 0, {}
    with_statistics = list(
        await session.scalars(
            select(Classroom.id).where(
                Classroom.id.in_(classrooms),
                func.jsonb_typeof(Classroom.statistics) == "array",
                Classroom.statistics != [],
            )
        )
    )
    minted: dict[uuid.UUID, str] = {}
    if shared:
        existing = set(
            await session.scalars(
                select(SharedStatistics.sharer_key).where(
                    SharedStatistics.classroom_id.in_(with_statistics)
                )
            )
        )
        rows = []
        for id_ in with_statistics:
            known = keys_in.get(id_)
            if known and resource_key(known) in existing:
                continue  # já liberada com esta chave: não conta duas vezes
            fresh = secrets.token_hex(32)
            minted[id_] = fresh
            rows.append({"classroom_id": id_, "sharer_key": resource_key(fresh)})
        if rows:
            await session.execute(
                insert(SharedStatistics).values(rows).on_conflict_do_nothing()
            )
    else:
        # Só a liberação de quem tem a chave: outro aluno que liberou a mesma turma continua valendo.
        for id_ in classrooms:
            known = keys_in.get(id_)
            if known:
                await session.execute(
                    delete(SharedStatistics).where(
                        SharedStatistics.classroom_id == id_,
                        SharedStatistics.sharer_key == resource_key(known),
                    )
                )
    return len(with_statistics), minted
