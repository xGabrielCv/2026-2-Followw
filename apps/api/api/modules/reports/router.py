from fastapi import APIRouter

from api.flags import require_enabled
from api.modules.reports.service import ReportCreated, ReportInput, ReportServiceDep

router = APIRouter()


# Sem login: o próprio docente ou qualquer pessoa pode pedir a exclusão de um conteúdo.
@router.post(
    "",
    response_model=ReportCreated,
    status_code=201,
    summary="Denunciar ou pedir a exclusão de um conteúdo da comunidade",
    description="Vai para a fila da moderação, que decide se apaga. Não guarda quem pediu.",
    responses={404: {"description": "Conteúdo não encontrado."}},
    dependencies=[require_enabled("reports")],
)
async def create_report(body: ReportInput, service: ReportServiceDep) -> ReportCreated:
    return await service.create(body)
