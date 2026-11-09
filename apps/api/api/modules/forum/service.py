"""Conversas públicas com credenciais aleatórias independentes por publicação."""

import uuid
from collections.abc import Collection
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api.anonymous import owns, resource_key
from api.community_limits import read_limits
from api.crypto import matches
from api.db.context import apply_context, set_context
from api.db.main import DatabaseDep
from api.db.models import Course, ForumPost, ForumReply, Subject
from api.db.pagination import paginate
from api.modules.class_groups.service import Campus
from api.schemas import SubjectReference

PostKind = Literal["duvida", "post"]
PostOrder = Literal["recent", "active", "unanswered", "resolved", "unresolved"]
FORUM_PAGE_SIZE = 20
MAX_REPLIES = 500


def _scope(post_id: uuid.UUID) -> str:
    return f"forum:{post_id}"


# A busca decifra as publicações mais recentes que passam pelos outros filtros.
_SEARCH_WINDOW = 2000


class PostInput(BaseModel):
    kind: PostKind
    title: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=5, max_length=120)
    ]
    body: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)
    ]
    campus: Campus | None = None
    subject: (
        Annotated[
            str,
            StringConstraints(
                strip_whitespace=True, to_upper=True, pattern=r"^[A-Za-z0-9]{3,16}$"
            ),
        ]
        | None
    ) = None
    # Curso público indicado voluntariamente; nunca valida identidade ou vínculo.
    course_id: int | None = Field(default=None, gt=0, le=2**31 - 1)


class ReplyInput(BaseModel):
    body: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)
    ]


class CourseTag(BaseModel):
    id: int
    name: str


class PostItem(BaseModel):
    id: uuid.UUID
    kind: PostKind
    resolved: bool
    title: str
    excerpt: str
    campus: Campus | None
    course: CourseTag | None
    subject: SubjectReference | None
    reply_count: int
    created_at: datetime
    last_activity_at: datetime
    mine: bool


class PostPage(BaseModel):
    items: list[PostItem]
    total: int
    page: int
    page_size: int


class ReplyItem(BaseModel):
    id: uuid.UUID
    body: str
    created_at: datetime
    mine: bool
    # Resposta de quem abriu a conversa.
    by_author: bool


class PostDetails(PostItem):
    body: str
    replies: list[ReplyItem]


async def _refs(
    session: AsyncSession, posts: list[ForumPost]
) -> tuple[dict[int, str], dict[str, str]]:
    courses = {post.course_id for post in posts if post.course_id}
    subjects = {post.subject_code for post in posts if post.subject_code}
    course_names = (
        dict(
            (
                await session.execute(
                    select(Course.id, Course.name).where(Course.id.in_(courses))
                )
            ).all()
        )
        if courses
        else {}
    )
    subject_names = (
        dict(
            (
                await session.execute(
                    select(Subject.code, Subject.name).where(Subject.code.in_(subjects))
                )
            ).all()
        )
        if subjects
        else {}
    )
    return course_names, subject_names


def _item(
    post: ForumPost,
    author: str,
    courses: dict[int, str],
    subjects: dict[str, str],
) -> PostItem:
    excerpt = " ".join(post.body.split())
    return PostItem(
        id=post.id,
        kind=post.kind,
        title=post.title,
        excerpt=excerpt if len(excerpt) <= 200 else f"{excerpt[:197]}...",
        campus=post.campus,
        course=CourseTag(id=post.course_id, name=courses.get(post.course_id, "Curso"))
        if post.course_id
        else None,
        subject=SubjectReference(
            code=post.subject_code,
            name=subjects.get(post.subject_code, post.subject_code),
        )
        if post.subject_code
        else None,
        reply_count=post.reply_count,
        resolved=post.resolved,
        created_at=post.created_at,
        last_activity_at=post.last_activity_at,
        mine=owns(post.author_key, author, _scope(post.id)),
    )


class ForumService:
    def __init__(self, db: DatabaseDep) -> None:
        self._db = db

    async def list(
        self,
        author: str,
        *,
        kind: PostKind | None,
        campus: Campus | None,
        course: int | None,
        subject: str | None,
        q: str | None,
        order: PostOrder,
        page: int,
        page_size: int,
        subjects: Collection[str] = (),
    ) -> PostPage:
        conditions = []
        if kind:
            conditions.append(ForumPost.kind == kind)
        if campus:
            # Quem não marcou campus aparece para todos.
            conditions.append(
                or_(ForumPost.campus == campus, ForumPost.campus.is_(None))
            )
        if course:
            conditions.append(ForumPost.course_id == course)
        if subject:
            conditions.append(ForumPost.subject_code == subject)
        if subjects:
            # "Das minhas matérias": os códigos vêm do navegador, que sabe o que o aluno cursa.
            conditions.append(ForumPost.subject_code.in_(subjects))
        if order == "unanswered":
            conditions.append(ForumPost.reply_count == 0)
        if order in ("resolved", "unresolved"):
            conditions.extend(
                [
                    ForumPost.kind == "duvida",
                    ForumPost.resolved == (order == "resolved"),
                ]
            )
        sort = (
            ForumPost.last_activity_at.desc()
            if order == "active"
            else ForumPost.created_at.desc()
        )

        async def load(session: AsyncSession) -> PostPage:
            query = select(ForumPost).where(*conditions).order_by(sort, ForumPost.id)
            if q:
                # Título e texto são cifrados no banco: a busca é feita já decifrada.
                found = [
                    post
                    for post in await session.scalars(query.limit(_SEARCH_WINDOW))
                    if matches(q, post.title, post.body)
                ]
                start = (page - 1) * page_size
                posts, total = found[start : start + page_size], len(found)
            else:
                posts, total = await paginate(session, query, page, page_size)
            courses, subjects = await _refs(session, posts)
            return PostPage(
                items=[_item(post, author, courses, subjects) for post in posts],
                total=total,
                page=page,
                page_size=page_size,
            )

        return await self._db.read(load)

    async def get(self, post_id: uuid.UUID, author: str) -> PostDetails:
        async def load(session: AsyncSession) -> PostDetails:
            post = await session.get(ForumPost, post_id)
            if post is None:
                raise HTTPException(404, "Publicação não encontrada.")
            replies = await session.scalars(
                select(ForumReply)
                .where(ForumReply.post_id == post_id)
                .order_by(ForumReply.created_at, ForumReply.id)
            )
            courses, subjects = await _refs(session, [post])
            scope = _scope(post.id)
            return PostDetails(
                **_item(post, author, courses, subjects).model_dump(),
                body=post.body,
                replies=[
                    ReplyItem(
                        id=reply.id,
                        body=reply.body,
                        created_at=reply.created_at,
                        mine=owns(reply.author_key, author, scope),
                        by_author=reply.by_op
                        or (
                            reply.author_key is not None
                            and reply.author_key == post.author_key
                        ),
                    )
                    for reply in replies
                ],
            )

        return await self._db.read(load)

    async def create(
        self,
        author: str,
        body: PostInput,
    ) -> PostDetails:
        post_id = uuid.uuid4()

        async def write(session: AsyncSession) -> None:
            await session.execute(text("SELECT pg_advisory_xact_lock(865942121)"))
            course_id = body.course_id
            if course_id is not None and await session.get(Course, course_id) is None:
                raise HTTPException(422, "Curso não encontrado.")
            if body.subject and await session.get(Subject, body.subject) is None:
                raise HTTPException(422, "Matéria não encontrada.")
            if len(body.body) >= 40:
                recent = await session.scalars(
                    select(ForumPost)
                    .where(
                        ForumPost.kind == body.kind,
                        ForumPost.subject_code.is_not_distinct_from(body.subject),
                        ForumPost.campus.is_not_distinct_from(body.campus),
                        ForumPost.course_id.is_not_distinct_from(course_id),
                        ForumPost.created_at >= datetime.now(UTC) - timedelta(days=1),
                    )
                    .order_by(ForumPost.created_at.desc())
                    .limit(_SEARCH_WINDOW)
                )

                def normalize(value):
                    return " ".join(value.casefold().split())

                if any(
                    normalize(row.title) == normalize(body.title)
                    and normalize(row.body) == normalize(body.body)
                    for row in recent
                ):
                    raise HTTPException(
                        409,
                        "Esta publicação já apareceu aqui nas últimas 24 horas. Confira a conversa existente.",
                    )
            session.add(
                ForumPost(
                    id=post_id,
                    kind=body.kind,
                    title=body.title,
                    body=body.body,
                    campus=body.campus,
                    course_id=course_id,
                    subject_code=body.subject,
                    author_key=resource_key(author),
                )
            )

        await self._db.write(write)
        return await self.get(post_id, author)

    async def set_resolved(
        self, post_id: uuid.UUID, author: str, resolved: bool
    ) -> PostDetails:
        async def write(session: AsyncSession):
            post = await session.get(ForumPost, post_id)
            if post is None or not owns(post.author_key, author, _scope(post_id)):
                raise HTTPException(404, "Publicação não encontrada.")
            if post.kind != "duvida":
                raise HTTPException(
                    422, "Somente dúvidas podem ser marcadas como resolvidas."
                )
            post.resolved = resolved

        await self._db.write(write)
        return await self.get(post_id, author)

    async def reply(
        self,
        post_id: uuid.UUID,
        author: str,
        body: ReplyInput,
        op_key: str | None = None,
    ) -> tuple[PostDetails, uuid.UUID]:
        reply_id = uuid.uuid4()
        set_context(reply_limit=str(MAX_REPLIES))

        async def write(session: AsyncSession) -> None:
            await session.execute(
                text("SELECT pg_advisory_xact_lock(:key)"),
                {"key": post_id.int % (2**63 - 1)},
            )
            post = await session.get(ForumPost, post_id)
            if post is None:
                raise HTTPException(404, "Publicação não encontrada.")
            limit = min(MAX_REPLIES, (await read_limits(session)).forum_replies)
            set_context(reply_limit=str(limit))
            await apply_context(session)
            if post.reply_count >= limit:
                raise HTTPException(409, "A conversa chegou ao limite de respostas.")
            if len(body.body) >= 40:
                recent = await session.scalars(
                    select(ForumReply.body)
                    .where(ForumReply.post_id == post_id)
                    .limit(MAX_REPLIES)
                )
                normalized = " ".join(body.body.casefold().split())
                if any(
                    " ".join(value.casefold().split()) == normalized for value in recent
                ):
                    raise HTTPException(409, "Esta resposta já existe na conversa.")
            session.add(
                ForumReply(
                    id=reply_id,
                    post_id=post_id,
                    body=body.body,
                    author_key=resource_key(author),
                    by_op=owns(post.author_key, op_key, _scope(post_id)),
                )
            )

        try:
            await self._db.write(write)
        except IntegrityError as error:
            cause = getattr(error.orig, "__cause__", None)
            if getattr(cause, "constraint_name", None) == "forum_reply_limit":
                raise HTTPException(
                    409, "A conversa chegou ao limite de respostas."
                ) from None
            raise
        return await self.get(post_id, author), reply_id

    async def delete_post(self, post_id: uuid.UUID, author: str) -> None:
        async def write(session: AsyncSession) -> None:
            post = await session.get(ForumPost, post_id)
            if post is None or not owns(post.author_key, author, _scope(post_id)):
                raise HTTPException(404, "Publicação não encontrada.")
            await session.delete(post)
            from api.modules.community.activity import record_deletion

            await record_deletion(session, "forum")

        await self._db.write(write)

    async def delete_reply(
        self, post_id: uuid.UUID, reply_id: uuid.UUID, author: str
    ) -> None:
        async def write(session: AsyncSession) -> None:
            reply = await session.get(ForumReply, reply_id)
            if (
                reply is None
                or reply.post_id != post_id
                or not owns(reply.author_key, author, _scope(post_id))
            ):
                raise HTTPException(404, "Resposta não encontrada.")
            await session.delete(reply)
            from api.modules.community.activity import record_deletion

            await record_deletion(session, "forum")

        await self._db.write(write)


ForumServiceDep = Annotated[ForumService, Depends()]
