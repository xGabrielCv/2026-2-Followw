from fastapi import APIRouter, Depends

from api.account import AccountDep
from api.cache import NoStore
from api.errors import SIGAA_ERRORS
from api.modules.demo.service import DemoServiceDep, DemoStatus, require_demo
from api.sigaa import SigaaConnectionDep

# Fora de produção: sem `DEMO_DATA`, todas as rotas respondem 404.
router = APIRouter(dependencies=[Depends(require_demo)])
_RESPONSES = {**SIGAA_ERRORS, 404: {"description": "Dados de demonstração desligados."}}


@router.get(
    "",
    response_model=DemoStatus,
    summary="Ver se os dados de demonstração estão carregados",
    responses=_RESPONSES,
    dependencies=[NoStore],
)
async def get_demo(_: SigaaConnectionDep, service: DemoServiceDep) -> DemoStatus:
    return await service.status()


@router.post(
    "",
    response_model=DemoStatus,
    summary="Carregar grupos, avaliações e índices fictícios das turmas do aluno",
    responses=_RESPONSES,
)
async def load_demo(account: AccountDep, service: DemoServiceDep) -> DemoStatus:
    return await service.load(account)


@router.delete(
    "",
    response_model=DemoStatus,
    summary="Apagar os dados de demonstração",
    responses=_RESPONSES,
)
async def clear_demo(_: SigaaConnectionDep, service: DemoServiceDep) -> DemoStatus:
    await service.clear()
    return await service.status()
