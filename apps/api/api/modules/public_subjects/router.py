from typing import Annotated

from fastapi import APIRouter, Query, Response
from pydantic import StringConstraints
from sigaa_client import Grade

from api.account import OptionalAccountDep
from api.cache import no_store
from api.db.enums import ClassroomStatus
from api.db.main import DatabaseDep
from api.modules.public_classrooms.code import ClassroomCode
from api.modules.public_subjects.outcomes import (
    Comparison,
    OutcomeServiceDep,
    SubjectOutcomes,
    comparison,
)
from api.modules.public_subjects.service import CatalogSubject, PublicSubjectServiceDep
from api.modules.public_subjects.statistics import (
    SubjectStatistics,
    SubjectStatisticsServiceDep,
)
from api.modules.recommendations.service import HistoryItem
from api.schemas import SearchText, UnitFilter

router = APIRouter()

_GRADES = "|".join(grade.value for grade in Grade)
_STATUSES = "|".join(status.value for status in ClassroomStatus)
_HISTORY = rf"^[A-Za-z0-9]{{1,16}}:[0-9]{{4}}\.[0-9]:({_GRADES})?:({_STATUSES})?$"


def _history_item(value: str) -> HistoryItem:
    code, semester, grade, status = value.split(":")
    return HistoryItem(
        code.upper(),
        semester,
        Grade(grade) if grade else None,
        ClassroomStatus(status) if status else None,
    )


@router.get(
    "/comparison",
    response_model=Comparison,
    summary="Índices gerais da UnB e de um curso, para comparação no aparelho",
    description="Médias das turmas com índices liberados pelos alunos (cada turma pesa igual). O app compara com o histórico que só ele guarda: nada do aluno é enviado.",
)
async def get_comparison(
    db: DatabaseDep,
    response: Response,
    course: Annotated[int | None, Query(gt=0, le=2**31 - 1)] = None,
) -> Comparison:
    response.headers["Cache-Control"] = "public, max-age=300"
    return await db.read(lambda session: comparison(session, course))


@router.get(
    "/semesters",
    response_model=list[str],
    summary="Semestres com oferta de turmas gravada",
    description="Os semestres mais recentes com turmas no Followw, do mais novo ao mais antigo. O próximo semestre aparece assim que a oferta dele é coletada do SIGAA.",
)
async def offer_semesters(
    service: PublicSubjectServiceDep, response: Response
) -> list[str]:
    semesters = await service.offer_semesters()
    no_store(response)
    return semesters


@router.get(
    "/{code}/outcomes",
    response_model=SubjectOutcomes,
    summary="Índices de aprovação e reprovação da matéria e de cada docente",
    description="Médias por turma das estatísticas já sincronizadas por alunos do Followw, de todos os semestres: a da matéria e, para cada docente que já a ofertou, a nela e a geral. `classrooms` diz em quantas turmas cada índice se baseia; sem dados, vem null.",
    responses={404: {"description": "Matéria não encontrada."}},
)
async def subject_outcomes(
    code: ClassroomCode, service: OutcomeServiceDep, response: Response
) -> SubjectOutcomes:
    result = await service.subject(code)
    no_store(response)
    return result


@router.get(
    "/{code}/statistics",
    response_model=SubjectStatistics,
    summary="Estatísticas anteriores da matéria com os mesmos docentes",
    description="Média simples por turma com dados, por semestre e geral. Considera apenas semestres anteriores à turma indicada e o mesmo conjunto de docentes. A cobertura depende dos dados já coletados; não consulta o SIGAA.",
)
async def subject_statistics(
    code: ClassroomCode,
    service: SubjectStatisticsServiceDep,
    response: Response,
    semester: Annotated[str, Query(pattern=r"^[0-9]{4}\.[0-9]$")],
    number: Annotated[str, Query(min_length=1, max_length=32)],
) -> SubjectStatistics:
    result = await service.get(code, semester, number)
    no_store(response)
    return result


@router.get(
    "",
    response_model=list[CatalogSubject],
    summary="Buscar matérias com suas turmas",
    description="Consulta os componentes e turmas gravados no Followw, sem ir ao SIGAA; os filtros se combinam. Cada componente traz as turmas do semestre consultado, vazias se não houver oferta. Sem q, code e unit, um aluno de graduação logado recebe as recomendações para o próximo semestre, ordenadas e com `recommendation`, a partir do histórico que o navegador manda em `history`; visitantes precisam informar um filtro.",
    responses={
        401: {"description": "Sessão inválida ao buscar recomendações."},
        422: {
            "description": "Visitante sem filtro, usuário fora da graduação ou sem matriz identificada sem filtro, filtro inválido, unidade inexistente ou nome de unidade ambíguo."
        },
        502: {
            "description": "Falha no SIGAA ao ler o perfil (sem ele no cookie do navegador)."
        },
    },
)
async def search_subjects(
    service: PublicSubjectServiceDep,
    account: OptionalAccountDep,
    response: Response,
    q: Annotated[
        SearchText | None,
        Query(
            description="Termos do código, nome do componente ou docente, de 3 a 32 caracteres; cada um precisa corresponder, ignorando acentos e maiúsculas. Um código completo também encontra equivalências diretas nos dois sentidos, incluindo integrantes de conjuntos.",
        ),
    ] = None,
    code: Annotated[
        ClassroomCode | None,
        Query(description="Código completo do componente, como FGA0003."),
    ] = None,
    unit: Annotated[
        UnitFilter | None,
        Query(
            description="ID ou código exato da unidade responsável, como 673 ou FCTE."
        ),
    ] = None,
    semester: Annotated[
        str | None,
        Query(
            pattern=r"^[0-9]{4}\.[0-9]$",
            description="Semestre das turmas, no formato AAAA.P. Sem ele, usa o mais recente gravado.",
        ),
    ] = None,
    completed: Annotated[
        list[Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9]{1,16}$")]],
        Query(
            max_length=200,
            description="Nas recomendações: matérias que o aluno marcou como concluídas no fluxo (guardadas só no navegador).",
        ),
    ] = [],  # noqa: B006 — o FastAPI copia o padrão a cada requisição
    history: Annotated[
        list[Annotated[str, StringConstraints(pattern=_HISTORY)]],
        Query(
            max_length=300,
            description="Nas recomendações: as turmas do aluno como `CODIGO:AAAA.P:MENCAO:SITUACAO` (menção e situação podem vir vazias). O navegador as tem da lista de turmas; o servidor não guarda o histórico.",
        ),
    ] = [],  # noqa: B006 — o FastAPI copia o padrão a cada requisição
) -> list[CatalogSubject]:
    subjects = await service.search(
        q,
        code=code,
        unit=unit,
        semester=semester,
        account=account,
        completed=frozenset(code.upper() for code in completed),
        history=tuple(_history_item(value) for value in history),
    )
    no_store(response)
    return subjects
