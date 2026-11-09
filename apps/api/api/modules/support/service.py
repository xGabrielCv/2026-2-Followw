"""Chamados anônimos: o acesso é uma posse (segredo do chamado), nunca uma identidade acadêmica."""

import hmac
import re
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import Depends, Header, HTTPException
from pydantic import BaseModel, StringConstraints
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.cookies import derive_key
from api.db.context import use_context
from api.db.main import DatabaseDep
from api.modules.support.models import Ticket, TicketMessage
from api.rate_limit import limit_by

Category = Literal[
    "bug",
    "help",
    "suggestion",
    "praise",
    "complaint",
    "review_question",
    "material_problem",
    "group_problem",
    "moderation_review",
    "other",
]
Status = Literal[
    "open", "in_review", "waiting_student", "answered", "resolved", "closed"
]
Priority = Literal["low", "normal", "high", "urgent"]
RelatedType = Literal["review", "group", "material", "post", "reply", "tutorial"]
Title = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=5, max_length=120)
]
Body = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=5, max_length=4000)
]

# Sem identificador de aluno ou aparelho: o limite de abertura é por origem de rede, na rota.
MAX_MESSAGES = 100
REOPEN_DAYS = 30
RECOVERY_ATTEMPTS = 5

# CPF, e-mail e matrícula (9 dígitos): o chamado não precisa de nenhum deles.
_PERSONAL = re.compile(
    r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|[\w.+-]+@[\w-]+\.[\w.-]+|\b\d{9}\b|\b\d{2}/\d{7}\b"
)

KEY_HEADER = "X-Ticket-Key"


def reject_personal_data(*texts: str | None) -> None:
    if any(text and _PERSONAL.search(text) for text in texts):
        raise HTTPException(
            422,
            "Remova CPF, e-mail ou matrícula do texto: o chamado não precisa de dados pessoais.",
        )


def _hash(value: str, purpose: str) -> str:
    return hmac.digest(
        derive_key(f"followw:ticket:{purpose}"), value.encode(), "sha256"
    ).hex()


def _recovery_code() -> str:
    raw = secrets.token_hex(8).upper()
    return "-".join(raw[i : i + 4] for i in range(0, 16, 4))


def _normalize_code(code: str) -> str:
    return re.sub(r"[^0-9A-F]", "", code.upper())


class TicketInput(BaseModel):
    credential: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    category: Category
    title: Title
    body: Body
    related_type: RelatedType | None = None
    related_id: uuid.UUID | None = None
    author_proof: (
        Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")] | None
    ) = None


class TicketCreated(BaseModel):
    id: uuid.UUID
    number: int
    # Mostrados uma única vez: o servidor guarda só verificadores.
    key: str
    recovery_code: str


class MessageInput(BaseModel):
    body: Body


class RecoverInput(BaseModel):
    new_key: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    id: uuid.UUID
    code: Annotated[str, StringConstraints(min_length=16, max_length=24)]


class KeyGranted(BaseModel):
    key: str


class MessageView(BaseModel):
    id: uuid.UUID
    sender: Literal["student", "staff"]
    body: str
    created_at: datetime


class TicketView(BaseModel):
    id: uuid.UUID
    number: int
    category: Category
    title: str
    status: Status
    created_at: datetime
    updated_at: datetime
    message_count: int
    can_reopen: bool
    messages: list[MessageView]
    appeal_outcome: Literal["accepted", "rejected"] | None = None
    appeal_author_proven: bool = False


def can_reopen(ticket: Ticket) -> bool:
    if ticket.status not in {"resolved", "closed"} or ticket.closed_at is None:
        return False
    if ticket.status == "closed" and ticket.closed_by == "staff":
        return False
    return datetime.now(UTC) - ticket.closed_at <= timedelta(days=REOPEN_DAYS)


async def _messages(session: AsyncSession, ticket_id: uuid.UUID) -> list[TicketMessage]:
    return list(
        await session.scalars(
            select(TicketMessage)
            .where(TicketMessage.ticket_id == ticket_id, TicketMessage.sender != "note")
            .order_by(TicketMessage.created_at, TicketMessage.id)
        )
    )


def _view(ticket: Ticket, messages: list[TicketMessage]) -> TicketView:
    return TicketView(
        id=ticket.id,
        number=ticket.number,
        category=ticket.category,
        title=ticket.title,
        status=ticket.status,
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
        message_count=len(messages),
        can_reopen=can_reopen(ticket),
        messages=[
            MessageView(id=m.id, sender=m.sender, body=m.body, created_at=m.created_at)
            for m in messages
        ],
        appeal_outcome=ticket.appeal_outcome,
        appeal_author_proven=ticket.appeal_author_proven,
    )


async def _owned(session: AsyncSession, ticket_id: uuid.UUID, key: str) -> Ticket:
    ticket = await session.get(Ticket, ticket_id, with_for_update=True)
    # Mesma resposta para "não existe" e "chave errada": nada de enumerar chamados.
    if ticket is None or not hmac.compare_digest(
        ticket.secret_hash, _hash(key, "secret")
    ):
        raise HTTPException(404, "Chamado não encontrado.")
    return ticket


class SupportService:
    def __init__(self, db: DatabaseDep) -> None:
        self._db = db

    async def create(self, body: TicketInput) -> TicketCreated:
        reject_personal_data(body.title, body.body)
        decision, proven, digest = None, False, None
        if body.category == "moderation_review":
            if not body.related_type or not body.related_id:
                raise HTTPException(
                    422,
                    "Informe o tipo e a referência pública do conteúdo para solicitar revisão.",
                )
            from api.modules.support.appeals import reference

            decision, proven = await reference(
                self._db, body.related_type, body.related_id, body.author_proof
            )
            digest = _hash(
                f"{datetime.now(UTC).date()}:{body.related_type}:{body.related_id}:{body.title.casefold()}:{body.body.casefold()}",
                "appeal-dedup",
            )
        key = body.credential
        code = _recovery_code()

        async def write(session: AsyncSession) -> TicketCreated:
            ticket = Ticket(
                secret_hash=_hash(key, "secret"),
                recovery_hash=_hash(_normalize_code(code), "recovery"),
                category=body.category,
                title=body.title,
                related_type=body.related_type,
                related_id=body.related_id,
                appeal_decision_id=decision,
                appeal_author_proven=proven,
                appeal_digest=digest,
                message_count=1,
            )
            session.add(ticket)
            await session.flush()
            session.add(
                TicketMessage(ticket_id=ticket.id, sender="student", body=body.body)
            )
            await session.flush()
            await session.refresh(ticket)
            return TicketCreated(
                id=ticket.id, number=ticket.number, key=key, recovery_code=code
            )

        # o banco só deixa criar neste escopo e ler o chamado recém-criado, pela própria chave
        with use_context(scope="ticket_create", ticket_hash=_hash(key, "secret")):
            try:
                return await self._db.write(write)
            except IntegrityError:
                if digest:
                    raise HTTPException(
                        409,
                        "Uma solicitação de revisão com o mesmo texto e referência já foi recebida hoje.",
                    ) from None
                raise

    async def get(self, ticket_id: uuid.UUID, key: str) -> TicketView:
        async def read(session: AsyncSession) -> TicketView:
            ticket = await _owned(session, ticket_id, key)
            return _view(ticket, await _messages(session, ticket.id))

        with use_context(ticket_hash=_hash(key, "secret")):
            return await self._db.read(read)

    async def reply(
        self, ticket_id: uuid.UUID, key: str, body: MessageInput
    ) -> TicketView:
        reject_personal_data(body.body)

        async def write(session: AsyncSession) -> TicketView:
            ticket = await _owned(session, ticket_id, key)
            if ticket.status == "closed":
                raise HTTPException(
                    409, "O chamado está encerrado. Reabra para responder."
                )
            if ticket.message_count >= MAX_MESSAGES:
                raise HTTPException(409, "O chamado chegou ao limite de mensagens.")
            session.add(
                TicketMessage(ticket_id=ticket.id, sender="student", body=body.body)
            )
            ticket.message_count += 1
            ticket.status = "open"
            ticket.closed_at = None
            await session.flush()
            await session.refresh(ticket)
            return _view(ticket, await _messages(session, ticket.id))

        with use_context(ticket_hash=_hash(key, "secret")):
            return await self._db.write(write)

    async def close(self, ticket_id: uuid.UUID, key: str) -> TicketView:
        async def write(session: AsyncSession) -> TicketView:
            ticket = await _owned(session, ticket_id, key)
            if ticket.status != "closed":
                ticket.status, ticket.closed_by = "closed", "student"
                ticket.closed_at = datetime.now(UTC)
            await session.flush()
            await session.refresh(ticket)
            return _view(ticket, await _messages(session, ticket.id))

        with use_context(ticket_hash=_hash(key, "secret")):
            return await self._db.write(write)

    async def reopen(self, ticket_id: uuid.UUID, key: str) -> TicketView:
        async def write(session: AsyncSession) -> TicketView:
            ticket = await _owned(session, ticket_id, key)
            if not can_reopen(ticket):
                raise HTTPException(409, "Este chamado não pode ser reaberto.")
            ticket.status, ticket.closed_by, ticket.closed_at = "open", None, None
            await session.flush()
            await session.refresh(ticket)
            return _view(ticket, await _messages(session, ticket.id))

        with use_context(ticket_hash=_hash(key, "secret")):
            return await self._db.write(write)

    async def recover(self, body: RecoverInput) -> KeyGranted:
        # Cota por chamado, de qualquer IP: o código tem 64 bits, mas não vale arriscar.
        await limit_by("ticket-recover", str(body.id), RECOVERY_ATTEMPTS, 3600)
        code = _normalize_code(body.code)

        async def write(session: AsyncSession) -> KeyGranted:
            ticket = await session.get(Ticket, body.id, with_for_update=True)
            if (
                ticket is None
                or ticket.recovery_hash is None
                or len(code) != 16
                or not hmac.compare_digest(
                    ticket.recovery_hash, _hash(code, "recovery")
                )
            ):
                raise HTTPException(404, "Chamado ou código inválido.")
            key = body.new_key
            ticket.secret_hash = _hash(key, "secret")  # a chave antiga deixa de valer
            return KeyGranted(key=key)

        with use_context(recovery_hash=_hash(code, "recovery")):
            return await self._db.write(write)


SupportServiceDep = Annotated[SupportService, Depends()]
TicketKey = Annotated[
    str,
    Header(alias=KEY_HEADER, min_length=32, max_length=64, pattern=r"^[A-Za-z0-9_-]+$"),
]
