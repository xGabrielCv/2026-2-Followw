from typing import Annotated
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Form, HTTPException, Path, Query, Response, UploadFile
from pydantic import StringConstraints

from api.anonymous import AuthorDep, OptionalAuthorDep
from api.cache import NoStore
from api.errors import SIGAA_ERRORS
from api.flags import require_enabled
from api.modules.materials.service import (
    MAX_FILE_BYTES,
    MaterialItem,
    MaterialKind,
    MaterialServiceDep,
    MaterialUpload,
    SubjectMaterials,
    SubjectWithMaterials,
)
from api.rate_limit import publish_quota
from api.schemas import SearchText
from api.sigaa import SigaaConnectionDep

router = APIRouter()

Code = Annotated[str, Path(pattern=r"^[A-Za-z0-9]{3,16}$")]
_NOT_FOUND = {
    **SIGAA_ERRORS,
    404: {"description": "Matéria ou material não encontrado."},
}
_CHUNK = 1024 * 1024


# Consulta e download públicos; envio e exclusão exigem login.
@router.get(
    "",
    response_model=list[SubjectWithMaterials],
    summary="Matérias com material compartilhado",
    responses=SIGAA_ERRORS,
    dependencies=[NoStore],
)
async def list_subjects(
    service: MaterialServiceDep,
    q: Annotated[SearchText | None, Query(description="Código ou nome.")] = None,
) -> list[SubjectWithMaterials]:
    return await service.subjects(q)


@router.get(
    "/{code}",
    response_model=SubjectMaterials,
    summary="Materiais de uma matéria, com os limites e o uso",
    responses=_NOT_FOUND,
    dependencies=[NoStore],
)
async def list_materials(
    author: OptionalAuthorDep,
    service: MaterialServiceDep,
    code: Code,
) -> SubjectMaterials:
    return await service.list(code.upper(), author)


@router.post(
    "/{code}",
    response_model=MaterialItem,
    status_code=201,
    summary="Enviar um material para a matéria, anonimamente",
    description="PDF ou imagem de até 20 MB. O tipo é conferido pelo conteúdo e o arquivo é regravado sem metadados (autor, GPS, aparelho).",
    responses={
        **_NOT_FOUND,
        409: {"description": "Limite atingido ou arquivo repetido."},
        413: {"description": "Arquivo grande demais."},
        415: {"description": "Tipo de arquivo não aceito."},
    },
    dependencies=[require_enabled("materials"), publish_quota("materials", 10)],
)
async def upload_material(
    author: AuthorDep,
    connection: SigaaConnectionDep,
    service: MaterialServiceDep,
    response: Response,
    code: Code,
    file: UploadFile,
    title: Annotated[
        str,
        Form(),
        StringConstraints(strip_whitespace=True, min_length=3, max_length=80),
    ],
    kind: Annotated[MaterialKind, Form()],
    semester: Annotated[str, Form(pattern=r"^[0-9]{4}\.[0-9]$")],
    classroom_number: Annotated[str | None, Form(pattern=r"^[0-9A-Za-z]{1,4}$")] = None,
) -> MaterialItem:
    # Lê aos poucos e para logo acima do limite, sem guardar um arquivo enorme na memória.
    data = bytearray()
    while chunk := await file.read(_CHUNK):
        data += chunk
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(413, "Arquivo maior que 20 MB.")
    item = await service.upload(
        code.upper(),
        author,
        MaterialUpload(
            title=title, kind=kind, semester=semester, classroom_number=classroom_number
        ),
        file.filename or "material",
        bytes(data),
    )
    response.headers["X-Created-Id"] = str(item.id)
    return item


@router.get(
    "/{code}/{material_id}",
    response_class=Response,
    summary="Baixar um material",
    responses={
        **_NOT_FOUND,
        200: {
            "content": {
                "application/octet-stream": {
                    "schema": {"type": "string", "format": "binary"}
                }
            }
        },
    },
)
async def download_material(
    service: MaterialServiceDep, code: Code, material_id: UUID
) -> Response:
    material, data = await service.download(code.upper(), material_id)
    return Response(
        content=data,
        media_type=material.mime,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(material.filename)}",
            # O navegador nunca trata o arquivo como outra coisa nem roda nada dele.
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "Cache-Control": "private, max-age=3600",
        },
    )


@router.delete(
    "/{code}/{material_id}",
    status_code=204,
    summary="Apagar um material que o próprio aluno enviou",
    responses=_NOT_FOUND,
)
async def delete_material(
    author: AuthorDep,
    connection: SigaaConnectionDep,
    service: MaterialServiceDep,
    code: Code,
    material_id: UUID,
) -> None:
    await service.delete(code.upper(), material_id, author)
