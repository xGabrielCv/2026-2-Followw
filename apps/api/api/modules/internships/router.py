"""Mural de estágios do SIGAA, lido na hora com a sessão do aluno e sem gravação.

As ofertas não são dado pessoal, mas a divisão "do seu curso" depende de quem pergunta; o navegador
guarda a resposta.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Path, Query
from sigaa_client import Internship, InternshipSummary

from api.cache import NoStore
from api.errors import SIGAA_ERRORS
from api.sigaa import SigaaClientDep

router = APIRouter()

_MINE = "listagem_meu_curso"
Reference = Annotated[
    str,
    Path(
        pattern=r"^listagem_(meu_curso|outros_cursos):[0-9]{1,4}:[0-9a-f]{64}$",
        description="A `reference` da listagem (vale enquanto o mural não muda).",
    ),
]


class InternshipItem(InternshipSummary):
    # do curso do aluno (a primeira tabela do mural) ou de outros cursos
    mine: bool


@router.get(
    "",
    response_model=list[InternshipItem],
    summary="Listar as ofertas de estágio do mural do SIGAA",
    description="Lidas do SIGAA na hora, sem gravação. `mine` marca as do curso do aluno.",
    responses=SIGAA_ERRORS,
    dependencies=[NoStore],
)
async def list_internships(
    client: SigaaClientDep,
    scope: Annotated[Literal["all", "mine"], Query()] = "all",
) -> list[InternshipItem]:
    items = await client.internships.list_internships(only_my_course=scope == "mine")
    return [
        InternshipItem(**item.model_dump(), mine=item.reference.startswith(_MINE))
        for item in items
    ]


@router.get(
    "/{reference}",
    response_model=Internship,
    summary="Ver os detalhes de uma oferta de estágio",
    responses={
        **SIGAA_ERRORS,
        404: {"description": "O mural mudou desde a listagem: liste de novo."},
    },
    dependencies=[NoStore],
)
async def get_internship(client: SigaaClientDep, reference: Reference) -> Internship:
    return await client.internships.get_internship(reference)
