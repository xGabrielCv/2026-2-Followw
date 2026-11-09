import uuid

from fastapi import APIRouter

from api.cache import NoStore
from api.modules.support.service import (
    KeyGranted,
    MessageInput,
    RecoverInput,
    SupportServiceDep,
    TicketCreated,
    TicketInput,
    TicketKey,
    TicketView,
)
from api.rate_limit import publish_quota

# Sem login: o acesso é a posse da chave do chamado, que só o aparelho do aluno guarda.
router = APIRouter(dependencies=[NoStore])
_NOT_FOUND = {404: {"description": "Chamado não encontrado."}}


@router.post(
    "/tickets",
    response_model=TicketCreated,
    status_code=201,
    summary="Abrir um chamado de suporte anônimo",
    description="Devolve a chave e o código de recuperação uma única vez. Não guarda matrícula, nome, e-mail nem identificador de aparelho.",
    dependencies=[publish_quota("support", 10)],
)
async def create_ticket(body: TicketInput, service: SupportServiceDep) -> TicketCreated:
    return await service.create(body)


@router.post(
    "/recover",
    response_model=KeyGranted,
    summary="Recuperar o acesso a um chamado com o código de recuperação",
    responses=_NOT_FOUND,
)
async def recover_ticket(body: RecoverInput, service: SupportServiceDep) -> KeyGranted:
    return await service.recover(body)


@router.get(
    "/tickets/{ticket_id}",
    response_model=TicketView,
    summary="Ver um chamado e suas mensagens",
    responses=_NOT_FOUND,
)
async def get_ticket(
    ticket_id: uuid.UUID, key: TicketKey, service: SupportServiceDep
) -> TicketView:
    return await service.get(ticket_id, key)


@router.post(
    "/tickets/{ticket_id}/messages",
    response_model=TicketView,
    summary="Responder ao atendimento",
    responses={**_NOT_FOUND, 409: {"description": "Chamado encerrado ou cheio."}},
)
async def reply_ticket(
    ticket_id: uuid.UUID, body: MessageInput, key: TicketKey, service: SupportServiceDep
) -> TicketView:
    return await service.reply(ticket_id, key, body)


@router.post(
    "/tickets/{ticket_id}/close",
    response_model=TicketView,
    summary="Encerrar o próprio chamado",
    responses=_NOT_FOUND,
)
async def close_ticket(
    ticket_id: uuid.UUID, key: TicketKey, service: SupportServiceDep
) -> TicketView:
    return await service.close(ticket_id, key)


@router.post(
    "/tickets/{ticket_id}/reopen",
    response_model=TicketView,
    summary="Reabrir um chamado resolvido ou encerrado pelo próprio aluno",
    responses={**_NOT_FOUND, 409: {"description": "Não pode ser reaberto."}},
)
async def reopen_ticket(
    ticket_id: uuid.UUID, key: TicketKey, service: SupportServiceDep
) -> TicketView:
    return await service.reopen(ticket_id, key)
