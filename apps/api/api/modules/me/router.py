from fastapi import APIRouter, Request, Response
from sigaa_client import RestaurantCredentials, RestaurantStatement

from api.account import AccountDep
from api.anonymous import AuthorDep
from api.cache import CacheControl, NoStore
from api.db.main import DatabaseDep
from api.errors import SIGAA_ERRORS
from api.modules.me.profile import ProfileServiceDep, UserProfile
from api.modules.me.sharing import SharingInput, SharingStatus, set_sharing
from api.sigaa import SigaaClientDep, SigaaConnection, SigaaConnectionDep
from api.sync.queue import JobQueueDep

router = APIRouter()
_DOCUMENT_ERRORS = {
    **SIGAA_ERRORS,
    422: {"description": "O SIGAA recusou emitir o documento (ex.: perfil sem foto)."},
}
_PDF_RESPONSES = {
    **_DOCUMENT_ERRORS,
    200: {
        "content": {
            "application/pdf": {"schema": {"type": "string", "format": "binary"}}
        }
    },
}


@router.get(
    "",
    response_model=UserProfile,
    summary="Consultar o perfil do usuário autenticado",
    description="O perfil fica num cookie cifrado do navegador e é renovado no SIGAA a cada 24 h (ou com no-cache); o servidor não o grava.",
    responses=SIGAA_ERRORS,
)
async def get_me(service: ProfileServiceDep) -> UserProfile:
    return await service.get_profile()


@router.get(
    "/ru-statement",
    response_model=RestaurantStatement,
    summary="Consultar extrato, saldo e grupo do RU",
    responses=SIGAA_ERRORS,
    dependencies=[NoStore],
)
async def get_statement(
    request: Request, connection: SigaaConnectionDep
) -> RestaurantStatement:
    if not CacheControl.parse(request.headers.get("Cache-Control")).no_cache:
        client = await connection.client()
        return await client.restaurant.get_restaurant_statement()

    fresh = SigaaConnection(connection.credentials)
    try:
        client = await fresh.client()
        return await client.restaurant.get_restaurant_statement()
    finally:
        await fresh.aclose(logout=True)


@router.get(
    "/ru-token",
    response_model=RestaurantCredentials,
    summary="Consultar o token da carteirinha estudantil",
    description="Lê o QR code da carteirinha no SIGAA a cada acesso, sem persistência. Retorna token e valid_until; a validade informa mês/ano e o scraper representa o mês pelo dia 1.",
    responses=_DOCUMENT_ERRORS,
    dependencies=[NoStore],
)
async def get_token(client: SigaaClientDep) -> RestaurantCredentials:
    return await client.restaurant.get_restaurant_credentials()


@router.post(
    "/student-card",
    response_class=Response,
    summary="Baixar a carteirinha estudantil em PDF",
    responses=_PDF_RESPONSES,
    dependencies=[NoStore],
)
async def get_student_card(client: SigaaClientDep, response: Response) -> Response:
    pdf = await client.documents.get_student_card_pdf()
    return _document_download(pdf, "carteirinha.pdf", response)


@router.post(
    "/transcript",
    response_class=Response,
    summary="Baixar o histórico acadêmico em PDF",
    responses=_PDF_RESPONSES,
    dependencies=[NoStore],
)
async def get_transcript(client: SigaaClientDep, response: Response) -> Response:
    pdf = await client.documents.get_transcript_pdf()
    return _document_download(pdf, "historico.pdf", response)


def _document_download(content: bytes, filename: str, response: Response) -> Response:
    download = Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
    download.raw_headers.extend(response.raw_headers)
    return download


@router.put(
    "/statistics-sharing",
    response_model=SharingStatus,
    summary="Compartilhar (ou não) as estatísticas das turmas do aluno",
    description="Libera nos índices públicos as estatísticas das turmas encerradas do aluno. A escolha fica no navegador; o servidor só guarda que a turma tem estatística liberada, com uma chave anônima por turma. Índices que faltam são buscados num job (pending).",
    responses=SIGAA_ERRORS,
    dependencies=[NoStore],
)
async def put_statistics_sharing(
    body: SharingInput,
    account: AccountDep,
    db: DatabaseDep,
    queue: JobQueueDep,
    author: AuthorDep,
) -> SharingStatus:
    return await set_sharing(account, db, queue, body.shared, author)
