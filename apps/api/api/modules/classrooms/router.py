from collections.abc import AsyncIterator
from typing import Annotated

from anyio import CapacityLimiter, WouldBlock
from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from sigaa_client import (
    ClassroomPost,
    ClassroomTeachingPlan,
    PostType,
    StatisticsShare,
)

from api.cache import NoStore
from api.downloads import attachment
from api.errors import SIGAA_ERRORS
from api.modules.classrooms.frequency import (
    ClassroomFrequencyResult,
    FrequencyServiceDep,
)
from api.modules.classrooms.lessons import ClassroomFrequencyView
from api.modules.classrooms.posts import ClassroomPostsServiceDep
from api.modules.classrooms.service import (
    ClassroomMembers,
    ClassroomServiceDep,
    ParticipantClassroom,
)

router = APIRouter()

CLASSROOM_ERRORS = {
    **SIGAA_ERRORS,
    404: {"description": "Turma não encontrada entre as turmas do usuário."},
}
ClassroomId = Annotated[
    str,
    Path(
        pattern=r"^[A-Za-z0-9_-]{1,64}$",
        description="frontEndIdTurma (o id da lista) ou sigaa_id da turma.",
    ),
]


@router.get(
    "/{classroom_id}/teaching-plan",
    response_model=ClassroomTeachingPlan | None,
    summary="Consultar plano de ensino da turma",
    description="Metodologia, avaliação, atendimento, cronograma e referências, lidos do SIGAA na hora e sem gravação; o navegador guarda a resposta.",
    responses=CLASSROOM_ERRORS,
)
async def get_classroom_teaching_plan(
    service: ClassroomServiceDep, classroom_id: ClassroomId
) -> ClassroomTeachingPlan | None:
    return await service.get_teaching_plan(classroom_id)


@router.get(
    "/{classroom_id}/posts",
    response_model=list[ClassroomPost],
    summary="Consultar posts de uma turma",
    description="Notícias, tópicos, materiais e agenda de avaliações, lidos do SIGAA na hora e sem gravação (podem citar alunos). Materiais referenciam o tópico por topic_id. O texto das notícias vem no detalhe.",
    responses=CLASSROOM_ERRORS,
)
async def get_classroom_posts(
    service: ClassroomPostsServiceDep,
    classroom_id: ClassroomId,
    post_type: Annotated[
        PostType | None,
        Query(alias="type", description="Filtrar por categoria do post."),
    ] = None,
) -> list[ClassroomPost]:
    posts = await service.list_posts(classroom_id)
    return [post for post in posts if post_type is None or post.type == post_type]


@router.get(
    "/{classroom_id}/posts/{post_id}",
    response_model=ClassroomPost,
    summary="Consultar um post da turma",
    description="Use o id retornado na listagem. Notícias trazem texto em Markdown e anexos, lidos do SIGAA na hora. Avaliações não incluem notas individuais.",
    responses={
        **CLASSROOM_ERRORS,
        404: {"description": "Turma ou post não encontrado."},
    },
)
async def get_classroom_post(
    service: ClassroomPostsServiceDep,
    classroom_id: ClassroomId,
    post_id: Annotated[
        str,
        Path(
            pattern=r"^(news:[1-9][0-9]*|assessment:[1-9][0-9]*|topic:[a-f0-9]{64}|material:[a-f0-9]{64})$",
            description="ID do post na listagem da turma.",
        ),
    ],
) -> ClassroomPost:
    return await service.get_post(classroom_id, post_id)


_MAX_MATERIAL_BYTES = 20 * 1024 * 1024
_MATERIAL_DOWNLOAD_SLOTS = CapacityLimiter(4)


async def _reserve_download_slot() -> AsyncIterator[None]:
    try:
        _MATERIAL_DOWNLOAD_SLOTS.acquire_nowait()
    except WouldBlock:
        raise HTTPException(
            503,
            "Downloads ocupados. Tente novamente em instantes.",
            headers={"Retry-After": "5"},
        ) from None
    try:
        yield
    finally:
        _MATERIAL_DOWNLOAD_SLOTS.release()


@router.post(
    "/{classroom_id}/posts/{post_id}/download",
    response_class=Response,
    summary="Baixar um arquivo dos tópicos da turma",
    dependencies=[NoStore, Depends(_reserve_download_slot)],
    responses={
        **CLASSROOM_ERRORS,
        413: {"description": "Arquivo maior que 20 MB."},
        503: {"description": "Downloads ocupados."},
        200: {
            "content": {
                "application/octet-stream": {
                    "schema": {"type": "string", "format": "binary"}
                }
            }
        },
    },
)
async def download_classroom_material(
    service: ClassroomServiceDep,
    response: Response,
    classroom_id: ClassroomId,
    post_id: Annotated[str, Path(pattern=r"^material:[a-f0-9]{64}$")],
) -> Response:
    turma = await service.get_turma(classroom_id)
    client = await service.account.client()
    content = bytearray()
    async with client.classrooms.download_classroom_material(
        turma.front_end_id, post_id
    ) as file:
        async for chunk in file.content:
            if len(content) + len(chunk) > _MAX_MATERIAL_BYTES:
                raise HTTPException(413, "Arquivo maior que 20 MB.")
            content.extend(chunk)
        return attachment(
            bytes(content), file.filename, "application/octet-stream", response
        )


@router.get(
    "",
    response_model=list[ParticipantClassroom],
    summary="Consultar as turmas do usuário autenticado",
    description="Lida do SIGAA na hora, sem gravar quem está na turma. As encerradas trazem a menção em grade (null até ser lançada); o navegador guarda a resposta.",
    responses=SIGAA_ERRORS,
)
async def get_classrooms(
    service: ClassroomServiceDep,
    semester: Annotated[
        str | None,
        Query(
            pattern=r"^(all|[0-9]{4}\.[0-9])$",
            description="Sem filtro: turmas atuais. Use 'all' ou um semestre no formato AAAA.P, como 2026.2.",
        ),
    ] = None,
) -> list[ParticipantClassroom]:
    return await service.list_classrooms(semester)


@router.get(
    "/frequency",
    response_model=list[ClassroomFrequencyResult],
    summary="Consultar frequência de todas as turmas atuais",
    description="Turmas atuais com identificação e a mesma frequência da rota individual. Falha em uma turma retorna erro, sem omiti-la da lista.",
    responses=CLASSROOM_ERRORS,
)
async def get_current_frequencies(
    service: FrequencyServiceDep,
) -> list[ClassroomFrequencyResult]:
    return await service.list_frequencies()


@router.get(
    "/{classroom_id}/frequency",
    response_model=ClassroomFrequencyView,
    summary="Consultar frequência e andamento de uma turma",
    description="Lida do SIGAA na hora; a situação do aluno não é gravada. frequency_status indica nao_registrada, parcialmente_registrada ou registrada nas entradas publicadas. lessons traz as aulas da turma (previstas pelo calendário e horário, com start_time e end_time) já começadas, as publicadas pelo SIGAA fora delas e as com situação, mais recentes primeiro; upcoming, as previstas que não começaram. As marcações do aluno ficam no navegador, que refaz os totais com elas.",
    responses=CLASSROOM_ERRORS,
)
async def get_classroom_frequency(
    service: FrequencyServiceDep,
    classroom_id: ClassroomId,
) -> ClassroomFrequencyView:
    return await service.get_frequency(classroom_id)


@router.get(
    "/{classroom_id}/members",
    response_model=ClassroomMembers,
    summary="Consultar docentes e discentes de uma turma do usuário",
    description="Lida do SIGAA na hora. Só os docentes, que são públicos, ficam no banco.",
    responses=CLASSROOM_ERRORS,
)
async def get_classroom_members(
    service: ClassroomServiceDep,
    classroom_id: ClassroomId,
) -> ClassroomMembers:
    return await service.list_members(classroom_id)


@router.get(
    "/{classroom_id}/statistics",
    response_model=list[StatisticsShare],
    summary="Consultar os resultados da própria turma",
    description="Percentuais por situação da turma encerrada, sem agregação com outras turmas. Lista vazia quando não há resultados disponíveis.",
    responses=CLASSROOM_ERRORS,
)
async def get_classroom_statistics(
    service: ClassroomServiceDep,
    classroom_id: ClassroomId,
) -> list[StatisticsShare]:
    return await service.get_statistics(classroom_id)
