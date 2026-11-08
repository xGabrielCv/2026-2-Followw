from typing import Annotated

from fastapi import APIRouter, Path, Query
from pydantic import Field

from api.cache import NoStore
from api.modules.professor_reviews.service import (
    ProfessorReviews,
    RatingSummary,
    ReviewServiceDep,
)
from api.modules.public_professors.repository import ProfessorOrder
from api.modules.public_professors.service import (
    PROFESSORS_PAGE_SIZE,
    ProfessorDetails,
    ProfessorPage,
    ProfessorServiceDep,
)
from api.modules.public_subjects.outcomes import OutcomeServiceDep, ProfessorOutcomes
from api.schemas import SearchText, UnitFilter

router = APIRouter()


@router.get(
    "",
    response_model=ProfessorPage,
    summary="Buscar docentes do catálogo público",
    responses={422: {"description": "Filtro inválido ou unidade inexistente."}},
    description="Lista docentes coletados do SIGAA, sem login. Nome, unidade, semestre e matéria se combinam. O semestre seleciona docentes que ministraram uma disciplina de graduação naquele período. Nos rankings (`best`, `worst`), quem não tem avaliação conta como nota zero.",
    dependencies=[NoStore],
)
async def list_professors(
    service: ProfessorServiceDep,
    q: Annotated[
        SearchText | None,
        Query(
            description="Termos do nome, de 3 a 32 caracteres; cada um precisa aparecer, ignorando acentos e maiúsculas.",
        ),
    ] = None,
    unit: Annotated[
        UnitFilter | None,
        Query(description="ID ou código exato da unidade, como 673 ou FCTE."),
    ] = None,
    semester: Annotated[
        str | None,
        Query(
            pattern=r"^[0-9]{4}(?:\.[0-9])?$",
            description="Período de graduação, como 2026.2; registros antigos podem vir só com o ano.",
        ),
    ] = None,
    subject: Annotated[
        SearchText | None,
        Query(description="Código ou nome de uma matéria que o docente deu."),
    ] = None,
    order: Annotated[ProfessorOrder, Query()] = "name",
    rated: Annotated[bool, Query(description="Só docentes com avaliação.")] = False,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = PROFESSORS_PAGE_SIZE,
) -> ProfessorPage:
    return await service.list(
        q, unit, semester, page, page_size, subject=subject, order=order, rated=rated
    )


# Antes de `/{siape}`, que tomaria "ratings" como SIAPE.
@router.get(
    "/ratings",
    response_model=dict[int, RatingSummary],
    summary="Notas médias e chamada de vários docentes de uma vez",
    description="Pelo SIAPE; quem não tem avaliação fica de fora.",
    dependencies=[NoStore],
)
async def get_ratings(
    service: ReviewServiceDep,
    siape: Annotated[
        list[Annotated[int, Field(gt=0, le=2**31 - 1)]], Query(max_length=50)
    ],
) -> dict[int, RatingSummary]:
    return await service.ratings(set(siape))


@router.get(
    "/{siape}",
    response_model=ProfessorDetails,
    summary="Consultar o perfil público de um docente",
    dependencies=[NoStore],
)
async def get_professor(
    service: ProfessorServiceDep,
    siape: Annotated[
        int, Path(gt=0, le=2**31 - 1, description="SIAPE do link público do SIGAA.")
    ],
) -> ProfessorDetails:
    return await service.get(siape)


@router.get(
    "/{siape}/outcomes",
    response_model=ProfessorOutcomes,
    summary="Índices de aprovação e reprovação do docente",
    description="Média por turma das estatísticas já sincronizadas por alunos do Followw: a geral do docente e a de cada matéria com dados.",
    responses={404: {"description": "Docente não encontrado."}},
    dependencies=[NoStore],
)
async def get_professor_outcomes(
    service: OutcomeServiceDep,
    siape: Annotated[int, Path(gt=0, le=2**31 - 1)],
) -> ProfessorOutcomes:
    return await service.professor(siape)


@router.get(
    "/{siape}/reviews",
    response_model=ProfessorReviews,
    summary="Avaliações anônimas do docente",
    description="A nota média, quantos dizem que cobra chamada e os comentários, sem nada de quem avaliou.",
    responses={404: {"description": "Docente não encontrado."}},
    dependencies=[NoStore],
)
async def get_professor_reviews(
    service: ReviewServiceDep,
    siape: Annotated[int, Path(gt=0, le=2**31 - 1)],
) -> ProfessorReviews:
    return await service.professor(siape)
