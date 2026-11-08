"""As postagens das turmas, lidas do SIGAA a cada pedido: podem citar alunos, então não são gravadas."""

from datetime import date, datetime, time
from typing import Annotated

from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sigaa_client import ClassroomPost, PostType

from api.modules.classrooms.service import (
    ClassroomServiceDep,
    ParticipantClassroom,
    Turma,
    to_classroom,
)

LATEST_NEWS_LIMIT = 5


class ClassroomNews(BaseModel):
    model_config = ConfigDict(frozen=True)

    classroom: ParticipantClassroom
    post: ClassroomPost


class LatestNewsFeed(BaseModel):
    items: list[ClassroomNews]


class ClassroomPostsService:
    def __init__(self, classrooms: ClassroomServiceDep) -> None:
        self._classrooms = classrooms

    async def latest_news(self) -> LatestNewsFeed:
        """As notícias mais recentes das turmas atuais; o conteúdo segue pelo detalhe."""
        news: list[ClassroomNews] = []
        # Em sequência: as turmas dividem a sessão do SIGAA.
        for turma in await self._classrooms.list_turmas():
            classroom = to_classroom(turma)
            news.extend(
                ClassroomNews(classroom=classroom, post=post)
                for post in await self._posts(turma)
                if post.type == PostType.NEWS
            )
        news.sort(key=lambda item: _published(item.post), reverse=True)
        return LatestNewsFeed(items=news[:LATEST_NEWS_LIMIT])

    async def list_posts(self, classroom_id: str) -> list[ClassroomPost]:
        return await self._posts(await self._classrooms.get_turma(classroom_id))

    async def get_post(self, classroom_id: str, post_id: str) -> ClassroomPost:
        turma = await self._classrooms.get_turma(classroom_id)
        if not post_id.startswith("news:"):
            post = next(
                (post for post in await self._posts(turma) if post.id == post_id), None
            )
            if post is None:
                raise HTTPException(404, "Classroom post not found")
            return post
        client = await self._classrooms.account.client()
        news = await client.classrooms.get_classroom_news(
            turma.front_end_id, int(post_id.removeprefix("news:"))
        )
        return ClassroomPost.from_news(news).model_copy(
            update={"classroom_sigaa_id": turma.row.sigaa_id}
        )

    async def _posts(self, turma: Turma) -> list[ClassroomPost]:
        client = await self._classrooms.account.client()
        posts = await client.classrooms.list_classroom_posts(turma.front_end_id)
        return sorted(
            (_listed(post, turma.row.sigaa_id) for post in posts),
            key=lambda post: (post.published_on or post.starts_on or date.min, post.id),
            reverse=True,
        )


def _listed(post: ClassroomPost, classroom_sigaa_id: int | None) -> ClassroomPost:
    """Na lista, a notícia vem sem o texto: ele segue pelo detalhe."""
    update: dict[str, object] = {"classroom_sigaa_id": classroom_sigaa_id}
    if post.type == PostType.NEWS:
        update |= {"content": None, "published_at": None, "attachments": ()}
    return post.model_copy(update=update)


def _published(post: ClassroomPost) -> datetime:
    if post.published_at is not None:
        return post.published_at.replace(tzinfo=None)
    return datetime.combine(post.published_on or date.min, time.min)


ClassroomPostsServiceDep = Annotated[ClassroomPostsService, Depends()]
