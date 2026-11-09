from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Header

from api.errors import SIGAA_ERRORS
from api.flags import require_enabled
from api.modules.community.permissions import CommunityWriteDep
from api.modules.professor_reviews.service import (
    CreatedReview,
    NewReview,
    Review,
    ReviewInput,
    ReviewServiceDep,
)

router = APIRouter()

Token = Annotated[
    str,
    Header(
        alias="X-Review-Token",
        min_length=16,
        max_length=128,
        description="O segredo devolvido ao criar a avaliação.",
    ),
]
_NOT_FOUND = {404: {"description": "Avaliação não encontrada ou segredo errado."}}


# O login só restringe aos alunos da UnB: quem avaliou nunca é gravado.
@router.post(
    "",
    response_model=CreatedReview,
    status_code=201,
    summary="Avaliar um docente anonimamente",
    responses={**SIGAA_ERRORS, 404: {"description": "Docente não encontrado."}},
    dependencies=[require_enabled("reviews")],
)
async def create_review(
    _: CommunityWriteDep, service: ReviewServiceDep, body: NewReview
) -> CreatedReview:
    return await service.create(body)


@router.put(
    "/{review_id}",
    response_model=Review,
    summary="Editar a própria avaliação",
    responses=_NOT_FOUND,
    dependencies=[require_enabled("reviews")],
)
async def update_review(
    _: CommunityWriteDep,
    service: ReviewServiceDep,
    review_id: UUID,
    token: Token,
    body: ReviewInput,
) -> Review:
    return await service.update(review_id, token, body)


@router.delete(
    "/{review_id}",
    status_code=204,
    summary="Apagar a própria avaliação",
    responses=_NOT_FOUND,
)
async def delete_review(
    _: CommunityWriteDep, service: ReviewServiceDep, review_id: UUID, token: Token
) -> None:
    await service.delete(review_id, token)
