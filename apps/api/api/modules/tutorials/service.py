"""Guias escritos pela comunidade (estágio, matrícula, documentos...), publicados após aprovação."""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import Depends, HTTPException
from pydantic import BaseModel, StringConstraints
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.anonymous import resource_key
from api.crypto import matches
from api.db.main import DatabaseDep
from api.db.models import Tutorial

Category = Literal[
    "matricula", "estagio", "documentos", "auxilios", "campus", "sigaa", "outros"
]
# Guias do mesmo aluno esperando aprovação ao mesmo tempo.
# Sem identificar quem enviou, o teto é da fila inteira (a moderação decide); por origem de rede há
# também uma cota por hora no roteador.
MAX_PENDING_TOTAL = 60
_SCOPE = "tutorials"


class TutorialInput(BaseModel):
    title: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=5, max_length=100)
    ]
    summary: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=10, max_length=240)
    ]
    body: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=50, max_length=20_000)
    ]
    category: Category


class TutorialItem(BaseModel):
    id: uuid.UUID
    title: str
    summary: str
    category: Category
    published_at: datetime | None


class TutorialDetails(TutorialItem):
    body: str


class TutorialSubmitted(BaseModel):
    id: uuid.UUID
    status: Literal["pending"] = "pending"


def _item(tutorial: Tutorial) -> TutorialItem:
    return TutorialItem(
        id=tutorial.id,
        title=tutorial.title,
        summary=tutorial.summary,
        category=tutorial.category,
        published_at=tutorial.approved_at,
    )


class TutorialService:
    def __init__(self, db: DatabaseDep) -> None:
        self._db = db

    async def list(
        self, category: Category | None, q: str | None
    ) -> list[TutorialItem]:
        async def load(session: AsyncSession) -> list[TutorialItem]:
            query = select(Tutorial).where(Tutorial.status == "approved")
            if category:
                query = query.where(Tutorial.category == category)
            rows = await session.scalars(query.order_by(Tutorial.approved_at.desc()))
            # Título e resumo são cifrados no banco: a busca é feita já decifrada.
            return [
                _item(tutorial)
                for tutorial in rows
                if not q or matches(q, tutorial.title, tutorial.summary)
            ]

        return await self._db.read(load)

    async def get(self, tutorial_id: uuid.UUID) -> TutorialDetails:
        async def load(session: AsyncSession) -> TutorialDetails:
            tutorial = await session.get(Tutorial, tutorial_id)
            if tutorial is None or tutorial.status != "approved":
                raise HTTPException(404, "Guia não encontrado.")
            return TutorialDetails(**_item(tutorial).model_dump(), body=tutorial.body)

        return await self._db.read(load)

    async def submit(self, author: str, body: TutorialInput) -> TutorialSubmitted:
        key = resource_key(author)

        async def write(session: AsyncSession) -> TutorialSubmitted:
            pending = await session.scalar(
                select(func.count(Tutorial.id)).where(Tutorial.status == "pending")
            )
            if (pending or 0) >= MAX_PENDING_TOTAL:
                raise HTTPException(
                    409,
                    "Há guias demais esperando aprovação. Tente de novo mais tarde.",
                )
            tutorial = Tutorial(**body.model_dump(), author_key=key, status="pending")
            session.add(tutorial)
            await session.flush()
            return TutorialSubmitted(id=tutorial.id)

        return await self._db.write(write)


TutorialServiceDep = Annotated[TutorialService, Depends()]
