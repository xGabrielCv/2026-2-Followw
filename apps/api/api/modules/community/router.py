"""Migração única da autoria antiga (segredo do aparelho por escopo) para credenciais por publicação.

O navegador manda o segredo antigo UMA vez; o servidor acha as linhas que ele reconhece, sorteia uma
chave aleatória nova para cada uma, grava só o verificador novo (apagando o antigo) e devolve as chaves
ao navegador. Depois disso o segredo antigo não serve para nada e o navegador o descarta: nenhuma
linha migrada tem relação com outra. Quem nunca migra mantém as linhas antigas como estavam.
"""

import hmac
import secrets
import uuid
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from api.anonymous import AuthorDep, anonymous_key, resource_key, same_key
from api.cache import NoStore
from api.db.context import apply_context, set_context
from api.db.main import DatabaseDep
from api.db.models import ForumPost, ForumReply, Material, SharedStatistics, Tutorial
from api.modules.forum.service import _scope as forum_scope
from api.modules.materials.service import _scope as material_scope
from api.modules.me.sharing import _scope as statistics_scope
from api.modules.tutorials.service import _SCOPE as TUTORIAL_SCOPE
from api.rate_limit import publish_quota

router = APIRouter(dependencies=[NoStore])
MAX_ROWS = 200_000


class Migrated(BaseModel):
    kind: Literal["post", "reply", "material", "tutorial"]
    id: uuid.UUID
    key: str


class MigrationResult(BaseModel):
    items: list[Migrated]
    # turma -> chave da liberação de índices
    statistics: dict[uuid.UUID, str]


def _fresh() -> str:
    return secrets.token_hex(32)


async def _claim(session: AsyncSession, secret: str, scope: str, new_key: str):
    set_context(
        scope="community_migrate",
        author_key=resource_key(new_key),
        legacy_author_key=anonymous_key(secret, scope),
    )
    await apply_context(session)


async def migrate(session: AsyncSession, secret: str) -> MigrationResult:
    set_context(
        scope="community_migrate",
        legacy_author_key=anonymous_key(secret, TUTORIAL_SCOPE),
    )
    await apply_context(session)
    items: list[Migrated] = []

    owned_posts: set[uuid.UUID] = set()
    for post_id, stored in (
        await session.execute(
            select(ForumPost.id, ForumPost.author_key)
            .where(ForumPost.author_key.is_not(None))
            .limit(MAX_ROWS)
        )
    ).all():
        if same_key(stored, secret, forum_scope(post_id)):
            owned_posts.add(post_id)
            key = _fresh()
            items.append(Migrated(kind="post", id=post_id, key=key))
            await _claim(session, secret, forum_scope(post_id), key)
            await session.execute(
                update(ForumPost)
                .where(ForumPost.id == post_id)
                .values(author_key=resource_key(key))
            )

    for reply_id, post_id, stored in (
        await session.execute(
            select(ForumReply.id, ForumReply.post_id, ForumReply.author_key)
            .where(ForumReply.author_key.is_not(None))
            .limit(MAX_ROWS)
        )
    ).all():
        if not same_key(stored, secret, forum_scope(post_id)):
            continue
        key = _fresh()
        items.append(Migrated(kind="reply", id=reply_id, key=key))
        await _claim(session, secret, forum_scope(post_id), key)
        # resposta do mesmo segredo no post que ele abriu: guarda o selo "quem abriu a conversa"
        await session.execute(
            update(ForumReply)
            .where(ForumReply.id == reply_id)
            .values(
                author_key=resource_key(key),
                by_op=ForumReply.by_op | (post_id in owned_posts),
            )
        )

    for material_id, code, stored in (
        await session.execute(
            select(Material.id, Material.subject_code, Material.uploader_key)
            .where(Material.uploader_key.is_not(None))
            .limit(MAX_ROWS)
        )
    ).all():
        if same_key(stored, secret, material_scope(code)):
            key = _fresh()
            items.append(Migrated(kind="material", id=material_id, key=key))
            await _claim(session, secret, material_scope(code), key)
            await session.execute(
                update(Material)
                .where(Material.id == material_id)
                .values(uploader_key=resource_key(key))
            )

    set_context(legacy_author_key=anonymous_key(secret, TUTORIAL_SCOPE))
    await apply_context(session)
    for tutorial_id, stored in (
        await session.execute(
            select(Tutorial.id, Tutorial.author_key)
            .where(Tutorial.author_key.is_not(None))
            .limit(MAX_ROWS)
        )
    ).all():
        if same_key(stored, secret, TUTORIAL_SCOPE):
            key = _fresh()
            items.append(Migrated(kind="tutorial", id=tutorial_id, key=key))
            await _claim(session, secret, TUTORIAL_SCOPE, key)
            await session.execute(
                update(Tutorial)
                .where(Tutorial.id == tutorial_id)
                .values(author_key=resource_key(key))
            )

    statistics: dict[uuid.UUID, str] = {}
    for classroom_id, stored in (
        await session.execute(
            select(SharedStatistics.classroom_id, SharedStatistics.sharer_key).limit(
                MAX_ROWS
            )
        )
    ).all():
        if hmac.compare_digest(
            stored, anonymous_key(secret, statistics_scope(classroom_id))
        ):
            key = _fresh()
            statistics[classroom_id] = key
            set_context(
                scope="community_migrate",
                share_keys=",".join(
                    [
                        anonymous_key(secret, statistics_scope(classroom_id)),
                        resource_key(key),
                    ]
                ),
            )
            await apply_context(session)
            await session.execute(
                update(SharedStatistics)
                .where(
                    SharedStatistics.classroom_id == classroom_id,
                    SharedStatistics.sharer_key == stored,
                )
                .values(sharer_key=resource_key(key))
            )
    return MigrationResult(items=items, statistics=statistics)


@router.post(
    "/migrate",
    response_model=MigrationResult,
    summary="Trocar a autoria antiga por credenciais independentes, uma por publicação",
    description="Uso único: o navegador manda o segredo antigo e recebe uma chave nova por publicação sua.",
    dependencies=[publish_quota("migrate", 6)],
)
async def migrate_authorship(author: AuthorDep, db: DatabaseDep) -> MigrationResult:
    return await db.write(lambda session: migrate(session, author))
