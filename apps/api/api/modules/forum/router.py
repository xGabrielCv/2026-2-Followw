from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header, Query, Response
from pydantic import StringConstraints

from api.account import AccountDep
from api.anonymous import AuthorDep, OptionalAuthorDep
from api.cache import NoStore
from api.errors import SIGAA_ERRORS
from api.flags import require_enabled
from api.modules.class_groups.service import Campus
from api.modules.forum.service import (
    FORUM_PAGE_SIZE,
    ForumServiceDep,
    PostDetails,
    PostInput,
    PostKind,
    PostOrder,
    PostPage,
    ReplyInput,
)
from api.rate_limit import publish_quota
from api.schemas import SearchText
from api.sigaa import SigaaConnectionDep

router = APIRouter()
_NOT_FOUND = {**SIGAA_ERRORS, 404: {"description": "Não encontrado."}}


# Leitura pública; publicações, respostas e exclusões exigem login.
@router.get(
    "",
    response_model=PostPage,
    summary="Dúvidas e publicações da comunidade",
    responses=SIGAA_ERRORS,
    dependencies=[NoStore],
)
async def list_posts(
    author: OptionalAuthorDep,
    service: ForumServiceDep,
    kind: Annotated[PostKind | None, Query()] = None,
    campus: Annotated[Campus | None, Query()] = None,
    course: Annotated[int | None, Query(gt=0, le=2**31 - 1)] = None,
    subject: Annotated[str | None, Query(pattern=r"^[A-Za-z0-9]{3,16}$")] = None,
    subjects: Annotated[
        list[Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9]{3,16}$")]],
        Query(
            max_length=30,
            description="Só destas matérias (ex.: as que o aluno cursa, que o navegador conhece).",
        ),
    ] = [],  # noqa: B006 — o FastAPI copia o padrão a cada requisição
    q: Annotated[SearchText | None, Query()] = None,
    order: Annotated[PostOrder, Query()] = "recent",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=50)] = FORUM_PAGE_SIZE,
) -> PostPage:
    return await service.list(
        author,
        kind=kind,
        campus=campus,
        course=course,
        subject=subject.upper() if subject else None,
        q=q,
        order=order,
        page=page,
        page_size=page_size,
        subjects=sorted({code.upper() for code in subjects}),
    )


@router.post(
    "",
    response_model=PostDetails,
    status_code=201,
    summary="Publicar uma dúvida ou um post anônimo",
    responses={**SIGAA_ERRORS, 422: {"description": "Campos inválidos."}},
    dependencies=[require_enabled("forum"), publish_quota("forum", 40)],
)
async def create_post(
    author: AuthorDep,
    account: AccountDep,
    service: ForumServiceDep,
    body: PostInput,
    response: Response,
) -> PostDetails:
    # O curso vem do perfil cifrado no navegador: o cliente não escolhe a marcação.
    profile = await account.profile() if body.tag_course else None
    details = await service.create(author, body, profile)
    response.headers["X-Created-Id"] = str(details.id)
    return details


@router.get(
    "/{post_id}",
    response_model=PostDetails,
    summary="Ler uma publicação com as respostas",
    responses=_NOT_FOUND,
    dependencies=[NoStore],
)
async def get_post(
    author: OptionalAuthorDep,
    service: ForumServiceDep,
    post_id: UUID,
) -> PostDetails:
    return await service.get(post_id, author)


@router.post(
    "/{post_id}/replies",
    response_model=PostDetails,
    status_code=201,
    summary="Responder anonimamente",
    responses={**_NOT_FOUND, 409: {"description": "Limite de respostas."}},
    dependencies=[require_enabled("forum"), publish_quota("forum", 120)],
)
async def reply_post(
    author: AuthorDep,
    connection: SigaaConnectionDep,
    service: ForumServiceDep,
    post_id: UUID,
    body: ReplyInput,
    response: Response,
    op_key: Annotated[
        str | None, Header(alias="X-Followw-Op-Key", include_in_schema=False)
    ] = None,
) -> PostDetails:
    details, reply_id = await service.reply(post_id, author, body, op_key)
    response.headers["X-Created-Id"] = str(reply_id)
    return details


@router.delete(
    "/{post_id}",
    status_code=204,
    summary="Apagar a própria publicação",
    responses=_NOT_FOUND,
)
async def delete_post(
    author: AuthorDep,
    connection: SigaaConnectionDep,
    service: ForumServiceDep,
    post_id: UUID,
) -> None:
    await service.delete_post(post_id, author)


@router.delete(
    "/{post_id}/replies/{reply_id}",
    status_code=204,
    summary="Apagar a própria resposta",
    responses=_NOT_FOUND,
)
async def delete_reply(
    author: AuthorDep,
    connection: SigaaConnectionDep,
    service: ForumServiceDep,
    post_id: UUID,
    reply_id: UUID,
) -> None:
    await service.delete_reply(post_id, reply_id, author)
