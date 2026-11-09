from typing import Annotated

from fastapi import APIRouter, Path, Query

from api.cache import NoStore
from api.errors import SIGAA_ERRORS
from api.flags import require_enabled
from api.modules.class_groups.service import (
    GROUPS_PAGE_SIZE,
    Campus,
    ClassroomGroups,
    GroupedClassroomPage,
    GroupServiceDep,
    GroupsInput,
)
from api.modules.community.permissions import CommunityWriteDep
from api.schemas import SearchText

router = APIRouter()

Code = Annotated[str, Path(pattern=r"^[A-Za-z0-9]{3,16}$")]
Semester = Annotated[str, Path(pattern=r"^[0-9]{4}\.[0-9]$")]
Number = Annotated[str, Path(pattern=r"^[0-9A-Za-z]{1,4}$")]
_NOT_FOUND = {**SIGAA_ERRORS, 404: {"description": "Turma não encontrada."}}


# Leitura pública; só alunos autenticados podem alterar os links.
@router.get(
    "",
    response_model=GroupedClassroomPage,
    summary="Listar as turmas com a quantidade de grupos cadastrados",
    responses=SIGAA_ERRORS,
    dependencies=[NoStore],
)
async def list_groups(
    service: GroupServiceDep,
    semester: Annotated[str, Query(pattern=r"^[0-9]{4}\.[0-9]$")],
    q: Annotated[
        SearchText | None, Query(description="Código ou nome da matéria.")
    ] = None,
    campus: Annotated[Campus | None, Query()] = None,
    with_groups: Annotated[bool, Query(description="Só turmas com grupo.")] = False,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=50)] = GROUPS_PAGE_SIZE,
) -> GroupedClassroomPage:
    return await service.list(semester, q, campus, with_groups, page, page_size)


@router.get(
    "/{code}/{semester}/{number}",
    response_model=ClassroomGroups,
    summary="Consultar os grupos de conversa de uma turma",
    responses=_NOT_FOUND,
    dependencies=[NoStore],
)
async def get_groups(
    service: GroupServiceDep,
    code: Code,
    semester: Semester,
    number: Number,
) -> ClassroomGroups:
    return await service.get(code.upper(), semester, number)


@router.put(
    "/{code}/{semester}/{number}",
    response_model=ClassroomGroups,
    summary="Trocar os grupos de conversa de uma turma (até 3)",
    description="Qualquer aluno logado edita; só a turma e os links são gravados, nunca quem editou.",
    responses=_NOT_FOUND,
    dependencies=[require_enabled("groups")],
)
async def put_groups(
    _: CommunityWriteDep,
    service: GroupServiceDep,
    code: Code,
    semester: Semester,
    number: Number,
    body: GroupsInput,
) -> ClassroomGroups:
    return await service.save(code.upper(), semester, number, body)
