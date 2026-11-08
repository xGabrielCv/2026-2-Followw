from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Query

from api.anonymous import AuthorDep
from api.cache import NoStore
from api.errors import SIGAA_ERRORS
from api.flags import require_enabled
from api.modules.tutorials.service import (
    Category,
    TutorialDetails,
    TutorialInput,
    TutorialItem,
    TutorialServiceDep,
    TutorialSubmitted,
)
from api.schemas import SearchText
from api.sigaa import SigaaConnectionDep

router = APIRouter()


@router.get(
    "",
    response_model=list[TutorialItem],
    summary="Guias aprovados da comunidade",
    dependencies=[NoStore],
)
async def list_tutorials(
    service: TutorialServiceDep,
    category: Annotated[Category | None, Query()] = None,
    q: Annotated[SearchText | None, Query()] = None,
) -> list[TutorialItem]:
    return await service.list(category, q)


@router.get(
    "/{tutorial_id}",
    response_model=TutorialDetails,
    summary="Ler um guia",
    responses={404: {"description": "Guia não encontrado ou ainda não aprovado."}},
    dependencies=[NoStore],
)
async def get_tutorial(
    service: TutorialServiceDep, tutorial_id: UUID
) -> TutorialDetails:
    return await service.get(tutorial_id)


@router.post(
    "",
    response_model=TutorialSubmitted,
    status_code=201,
    summary="Enviar um guia para aprovação",
    description="Só aparece depois que a moderação aprovar. Não guarda quem escreveu.",
    responses={
        **SIGAA_ERRORS,
        409: {"description": "Guias demais esperando aprovação."},
    },
    dependencies=[require_enabled("tutorials")],
)
async def submit_tutorial(
    author: AuthorDep,
    connection: SigaaConnectionDep,
    service: TutorialServiceDep,
    body: TutorialInput,
) -> TutorialSubmitted:
    return await service.submit(author, body)
