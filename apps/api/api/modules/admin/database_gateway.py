"""Gateway do CloudBeaver: Owner/MFA em cada pedido, sem repassar cookies acadêmicos."""

from http.cookies import SimpleCookie
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from starlette.background import BackgroundTask
from starlette.responses import StreamingResponse

from api.core.config import settings
from api.db.main import DatabaseDep
from api.modules.admin import auth
from api.modules.admin.permissions import Principal

PREFIX = "/api/admin/database/"
INTERNAL = "http://127.0.0.1:8978"


async def database_owner(request: Request, db: DatabaseDep) -> Principal:
    read_request = Request({**request.scope, "method": "GET"})
    principal = auth.authorize(await auth.require_admin(read_request, db), "owner")
    if request.method not in {"GET", "HEAD"}:
        origin = request.headers.get("origin")
        same_origin = f"{request.url.scheme}://{request.headers.get('host')}"
        if not origin or origin not in {*settings.cors_origins, same_origin}:
            raise HTTPException(403, "Abra o banco pelo painel do administrador.")
        if request.headers.get("sec-fetch-site") not in {None, "same-origin"}:
            raise HTTPException(403, "Origem recusada.")
    # A aplicação terceira não conhece X-Admin-Request; a origem é validada acima.
    return principal


router = APIRouter(dependencies=[Depends(database_owner)], include_in_schema=False)


def upstream_url(path: str, query: str) -> str:
    if any(part in {".", ".."} for part in path.split("/")) or any(
        char in path for char in ("\\", "%", "\x00")
    ):
        raise HTTPException(400, "Caminho inválido.")
    target = f"{INTERNAL}{PREFIX}{quote(path, safe='/')}"
    return f"{target}?{query}" if query else target


@router.get("")
async def entry() -> Response:
    return RedirectResponse(PREFIX, status_code=307)


@router.api_route(
    "/{path:path}", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]
)
async def proxy(request: Request, path: str) -> Response:
    if not settings.cloudbeaver_enabled:
        raise HTTPException(503, "CloudBeaver não está habilitado nesta instância.")
    target = upstream_url(path, request.url.query)
    headers = {
        name: value
        for name, value in request.headers.items()
        if name.lower()
        in {
            "accept",
            "accept-language",
            "content-type",
            "range",
            "if-range",
            "x-csrf-token",
        }
    }
    cookie = request.cookies.get("cb-session-id")
    if cookie:
        headers["cookie"] = f"cb-session-id={cookie}"
    client = httpx.AsyncClient(
        timeout=httpx.Timeout(60, connect=5), follow_redirects=False, trust_env=False
    )
    try:
        response = await client.send(
            client.build_request(
                request.method,
                target,
                headers=headers,
                content=await request.body(),
            ),
            stream=True,
        )
    except httpx.HTTPError:
        await client.aclose()
        raise HTTPException(
            503, "CloudBeaver indisponível. O supervisor tentará recuperá-lo."
        ) from None
    forwarded = {
        name: value
        for name, value in response.headers.items()
        if name.lower()
        in {"content-type", "content-disposition", "content-range", "accept-ranges"}
    }
    forwarded.update(
        {
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "X-Frame-Options": "DENY",
        }
    )
    if location := response.headers.get("location"):
        if location.startswith(PREFIX):
            forwarded["Location"] = location
        elif location.startswith(INTERNAL + PREFIX):
            forwarded["Location"] = location.removeprefix(INTERNAL)
        else:
            await response.aclose()
            await client.aclose()
            raise HTTPException(
                502, "Redirecionamento externo do gerenciador recusado."
            )

    async def close():
        await response.aclose()
        await client.aclose()

    result = StreamingResponse(
        response.aiter_bytes(),
        status_code=response.status_code,
        headers=forwarded,
        background=BackgroundTask(close),
    )
    for value in response.headers.get_list("set-cookie"):
        if value.lower().startswith("cb-session-id="):
            parsed = SimpleCookie()
            parsed.load(value)
            if token := parsed.get("cb-session-id"):
                result.set_cookie(
                    "cb-session-id",
                    token.value,
                    path=PREFIX,
                    httponly=True,
                    secure=settings.environment == "production",
                    samesite="strict",
                    max_age=0 if token["max-age"] == "0" else None,
                )
    return result
