"""Comunidade: dúvidas e publicações anônimas, com respostas.

Ninguém aparece com nome. Cada conversa tem a sua chave de autor (HMAC da matrícula com a
conversa): marca as respostas de quem perguntou e deixa apagar, mas não liga uma conversa a
outra do mesmo aluno.
"""

import uuid
from collections.abc import Collection
from datetime import UTC, datetime
from typing import Annotated, Literal

import sigaa_client
from fastapi import Depends, HTTPException
from pydantic import BaseModel, StringConstraints
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.anonymous import anonymous_key, same_key
from api.crypto import matches
from api.db.main import DatabaseDep
from api.db.models import Course, ForumPost, ForumReply, Subject
from api.db.pagination import paginate
from api.modules.class_groups.service import Campus
from api.modules.me.profile import enrollment
from api.schemas import SubjectReference

PostKind = Literal["duvida", "post"]
PostOrder = Literal["recent", "active", "unanswered"]
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
    # Marca o curso do aluno (lido do perfil), para quem filtra pelo próprio curso.
    tag_course: bool = False


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
        created_at=post.created_at,
        last_activity_at=post.last_activity_at,
        mine=same_key(post.author_key, author, _scope(post.id)),
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
                        mine=same_key(reply.author_key, author, scope),
                        by_author=reply.author_key == post.author_key,
                    )
                    for reply in replies
                ],
            )

        return await self._db.read(load)

    async def create(
        self,
        author: str,
        body: PostInput,
        profile: sigaa_client.UserProfile | None = None,
    ) -> PostDetails:
        post_id = uuid.uuid4()

        async def write(session: AsyncSession) -> None:
            course_id = None
            if profile is not None:
                course_id = (await enrollment(session, profile)).course_id
            if body.subject and await session.get(Subject, body.subject) is None:
                raise HTTPException(422, "Matéria não encontrada.")
            session.add(
                ForumPost(
                    id=post_id,
                    kind=body.kind,
                    title=body.title,
                    body=body.body,
                    campus=body.campus,
                    course_id=course_id,
                    subject_code=body.subject,
                    author_key=anonymous_key(author, _scope(post_id)),
                )
            )

        await self._db.write(write)
        return await self.get(post_id, author)

    async def reply(
        self, post_id: uuid.UUID, author: str, body: ReplyInput
    ) -> PostDetails:
        async def write(session: AsyncSession) -> None:
            post = await session.get(ForumPost, post_id, with_for_update=True)
            if post is None:
                raise HTTPException(404, "Publicação não encontrada.")
            if post.reply_count >= MAX_REPLIES:
                raise HTTPException(409, "A conversa chegou ao limite de respostas.")
            session.add(
                ForumReply(
                    post_id=post_id,
                    body=body.body,
                    author_key=anonymous_key(author, _scope(post_id)),
                )
            )
            post.reply_count += 1
            post.last_activity_at = datetime.now(UTC)

        await self._db.write(write)
        return await self.get(post_id, author)

    async def delete_post(self, post_id: uuid.UUID, author: str) -> None:
        async def write(session: AsyncSession) -> None:
            post = await session.get(ForumPost, post_id)
            if post is None or not same_key(post.author_key, author, _scope(post_id)):
                raise HTTPException(404, "Publicação não encontrada.")
            await session.delete(post)

        await self._db.write(write)

    async def delete_reply(
        self, post_id: uuid.UUID, reply_id: uuid.UUID, author: str
    ) -> None:
        async def write(session: AsyncSession) -> None:
            reply = await session.get(ForumReply, reply_id)
            if (
                reply is None
                or reply.post_id != post_id
                or not same_key(reply.author_key, author, _scope(post_id))
            ):
                raise HTTPException(404, "Resposta não encontrada.")
            await session.delete(reply)
            post = await session.get(ForumPost, post_id, with_for_update=True)
            if post is not None:
                post.reply_count = max(0, post.reply_count - 1)

        await self._db.write(write)


ForumServiceDep = Annotated[ForumService, Depends()]
