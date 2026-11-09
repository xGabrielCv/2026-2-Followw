"""Atendimento dos chamados pelo painel: moderadores, administradores e Owner (permissão `support`)."""

import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.crypto import matches
from api.db.main import DatabaseDep
from api.modules.admin import auth
from api.modules.admin.models import AdminAccount
from api.modules.admin.permissions import Principal, allowed
from api.modules.admin.service import log
from api.modules.support.models import Ticket, TicketMessage
from api.modules.support.service import (
    Body,
    Category,
    Priority,
    RelatedType,
    Status,
)
from api.schemas import SearchText

router = APIRouter(include_in_schema=False)
Staff = Annotated[Principal, auth.require_permission("support")]
_SEARCH_WINDOW = 500
STATUSES = ("open", "in_review", "waiting_student", "answered", "resolved", "closed")


class StaffMessage(BaseModel):
    id: uuid.UUID
    sender: Literal["student", "staff", "note"]
    body: str
    created_at: datetime
    admin: str | None


class StaffTicket(BaseModel):
    id: uuid.UUID
    number: int
    category: Category
    title: str
    status: Status
    priority: Priority
    assigned_to: uuid.UUID | None
    assigned_name: str | None
    related_type: RelatedType | None
    related_id: uuid.UUID | None
    message_count: int
    created_at: datetime
    updated_at: datetime


class StaffDetail(StaffTicket):
    messages: list[StaffMessage]


class StaffPage(BaseModel):
    items: list[StaffTicket]
    total: int
    page: int
    page_size: int


class StaffReply(BaseModel):
    body: Body
    # estado depois da resposta
    status: Literal["answered", "waiting_student", "resolved", "closed"] = "answered"


class StaffNote(BaseModel):
    body: Body


class StaffChange(BaseModel):
    status: Status | None = None
    priority: Priority | None = None
    # `assign` troca o responsável; sem o campo, nada muda. None = sem responsável.
    assign: bool = False
    assigned_to: uuid.UUID | None = None


def _ticket(row: Ticket, names: dict[uuid.UUID, str]) -> StaffTicket:
    return StaffTicket(
        id=row.id,
        number=row.number,
        category=row.category,
        title=row.title,
        status=row.status,
        priority=row.priority,
        assigned_to=row.assigned_to,
        assigned_name=names.get(row.assigned_to) if row.assigned_to else None,
        related_type=row.related_type,
        related_id=row.related_id,
        message_count=row.message_count,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def _names(session: AsyncSession, ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not ids:
        return {}
    rows = await session.execute(
        select(AdminAccount.id, AdminAccount.username).where(AdminAccount.id.in_(ids))
    )
    return {id_: name for id_, name in rows}


class StaffService:
    def __init__(self, db: DatabaseDep) -> None:
        self._db = db

    async def summary(self) -> dict[str, int]:
        async def read(session: AsyncSession) -> dict[str, int]:
            rows = await session.execute(
                select(Ticket.status, func.count(Ticket.id)).group_by(Ticket.status)
            )
            counts = {status: 0 for status in STATUSES}
            counts.update({status: total for status, total in rows})
            return counts

        return await self._db.read(read)

    async def list(
        self,
        *,
        status: str | None,
        category: str | None,
        priority: str | None,
        mine: uuid.UUID | None,
        unassigned: bool,
        q: str | None,
        page: int,
        page_size: int,
    ) -> StaffPage:
        async def read(session: AsyncSession) -> StaffPage:
            query = select(Ticket)
            if status:
                query = query.where(Ticket.status == status)
            else:
                query = query.where(Ticket.status != "closed")
            if category:
                query = query.where(Ticket.category == category)
            if priority:
                query = query.where(Ticket.priority == priority)
            if mine:
                query = query.where(Ticket.assigned_to == mine)
            if unassigned:
                query = query.where(Ticket.assigned_to.is_(None))
            query = query.order_by(Ticket.updated_at.desc(), Ticket.number.desc())
            if q:
                # Título cifrado: a busca decifra só uma janela recente, em memória.
                rows = [
                    row
                    for row in await session.scalars(query.limit(_SEARCH_WINDOW))
                    if matches(q, row.title)
                ]
                total = len(rows)
                rows = rows[(page - 1) * page_size : page * page_size]
            else:
                total = (
                    await session.scalar(
                        select(func.count()).select_from(
                            query.order_by(None).subquery()
                        )
                    )
                    or 0
                )
                rows = list(
                    await session.scalars(
                        query.offset((page - 1) * page_size).limit(page_size)
                    )
                )
            names = await _names(
                session, {r.assigned_to for r in rows if r.assigned_to}
            )
            return StaffPage(
                items=[_ticket(row, names) for row in rows],
                total=total,
                page=page,
                page_size=page_size,
            )

        return await self._db.read(read)

    async def detail(self, ticket_id: uuid.UUID) -> StaffDetail:
        async def read(session: AsyncSession) -> StaffDetail:
            ticket = await session.get(Ticket, ticket_id)
            if ticket is None:
                raise HTTPException(404, "Chamado não encontrado.")
            rows = list(
                await session.scalars(
                    select(TicketMessage)
                    .where(TicketMessage.ticket_id == ticket_id)
                    .order_by(TicketMessage.created_at, TicketMessage.id)
                )
            )
            ids = {m.admin_id for m in rows if m.admin_id}
            if ticket.assigned_to:
                ids.add(ticket.assigned_to)
            names = await _names(session, ids)
            return StaffDetail(
                **_ticket(ticket, names).model_dump(),
                messages=[
                    StaffMessage(
                        id=m.id,
                        sender=m.sender,
                        body=m.body,
                        created_at=m.created_at,
                        admin=names.get(m.admin_id) if m.admin_id else None,
                    )
                    for m in rows
                ],
            )

        return await self._db.read(read)

    async def _mutate(self, ticket_id: uuid.UUID, change) -> None:
        async def write(session: AsyncSession) -> None:
            ticket = await session.get(Ticket, ticket_id, with_for_update=True)
            if ticket is None:
                raise HTTPException(404, "Chamado não encontrado.")
            await change(session, ticket)
            await session.flush()

        await self._db.write(write)

    async def reply(
        self, actor: Principal, ticket_id: uuid.UUID, body: StaffReply
    ) -> None:
        async def change(session: AsyncSession, ticket: Ticket) -> None:
            session.add(
                TicketMessage(
                    ticket_id=ticket.id,
                    sender="staff",
                    body=body.body,
                    admin_id=actor.id,
                )
            )
            ticket.message_count += 1
            _set_status(ticket, body.status)
            await log(
                session, "support.reply", "ticket", ticket.id, body.status, actor=actor
            )

        await self._mutate(ticket_id, change)

    async def note(
        self, actor: Principal, ticket_id: uuid.UUID, body: StaffNote
    ) -> None:
        async def change(session: AsyncSession, ticket: Ticket) -> None:
            session.add(
                TicketMessage(
                    ticket_id=ticket.id,
                    sender="note",
                    body=body.body,
                    admin_id=actor.id,
                )
            )
            await log(session, "support.note", "ticket", ticket.id, actor=actor)

        await self._mutate(ticket_id, change)

    async def change(
        self, actor: Principal, ticket_id: uuid.UUID, body: StaffChange
    ) -> None:
        async def apply(session: AsyncSession, ticket: Ticket) -> None:
            details = []
            if body.status and body.status != ticket.status:
                _set_status(ticket, body.status)
                details.append(f"status={body.status}")
            if body.priority and body.priority != ticket.priority:
                ticket.priority = body.priority
                details.append(f"prioridade={body.priority}")
            if body.assign and body.assigned_to != ticket.assigned_to:
                target = body.assigned_to
                # Moderador só assume o chamado para si; atribuir a outros é de quem gere contas.
                if (
                    target
                    and target != actor.id
                    and not allowed(actor.role, "accounts")
                ):
                    raise HTTPException(
                        403, "Seu cargo só permite assumir o chamado para si."
                    )
                if target and await session.get(AdminAccount, target) is None:
                    raise HTTPException(404, "Responsável não encontrado.")
                ticket.assigned_to = target
                details.append("responsável alterado")
            if details:
                await log(
                    session,
                    "support.update",
                    "ticket",
                    ticket.id,
                    ", ".join(details),
                    actor=actor,
                )

        await self._mutate(ticket_id, apply)


def _set_status(ticket: Ticket, status: str) -> None:
    ticket.status = status
    if status in {"resolved", "closed"}:
        ticket.closed_at = datetime.now(UTC)
        ticket.closed_by = "staff"
    else:
        ticket.closed_at = None
        ticket.closed_by = None


StaffServiceDep = Annotated[StaffService, Depends()]


@router.get("/summary")
async def summary(_: Staff, service: StaffServiceDep) -> dict[str, int]:
    return await service.summary()


@router.get("", response_model=StaffPage)
async def tickets(
    actor: Staff,
    service: StaffServiceDep,
    status: Annotated[Status | None, Query()] = None,
    category: Annotated[Category | None, Query()] = None,
    priority: Annotated[Priority | None, Query()] = None,
    assignee: Annotated[Literal["me", "none"] | None, Query()] = None,
    q: Annotated[SearchText | None, Query()] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> StaffPage:
    return await service.list(
        status=status,
        category=category,
        priority=priority,
        mine=actor.id if assignee == "me" else None,
        unassigned=assignee == "none",
        q=q,
        page=page,
        page_size=page_size,
    )


@router.get("/{ticket_id}", response_model=StaffDetail)
async def ticket_detail(
    _: Staff, service: StaffServiceDep, ticket_id: uuid.UUID
) -> StaffDetail:
    return await service.detail(ticket_id)


@router.post("/{ticket_id}/reply", status_code=204)
async def ticket_reply(
    actor: Staff, service: StaffServiceDep, ticket_id: uuid.UUID, body: StaffReply
) -> None:
    await service.reply(actor, ticket_id, body)


@router.post("/{ticket_id}/note", status_code=204)
async def ticket_note(
    actor: Staff, service: StaffServiceDep, ticket_id: uuid.UUID, body: StaffNote
) -> None:
    await service.note(actor, ticket_id, body)


@router.patch("/{ticket_id}", status_code=204)
async def ticket_change(
    actor: Staff, service: StaffServiceDep, ticket_id: uuid.UUID, body: StaffChange
) -> None:
    await service.change(actor, ticket_id, body)
