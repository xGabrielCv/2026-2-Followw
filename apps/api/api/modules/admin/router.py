from pathlib import Path
from typing import Annotated, Any, Literal
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Query, Request, Response
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field, StringConstraints

from api.cache import NoStore
from api.modules.admin import auth
from api.modules.admin.auth import AdminDep
from api.modules.admin.service import (
    AdminServiceDep,
    Breakdown,
    ContentType,
    LogEntry,
    Overview,
    Page,
    ReportView,
    Series,
    TutorialEdit,
    TutorialView,
)
from api.schemas import SearchText

# Fora do OpenAPI: o app nunca conhece estas rotas.
router = APIRouter(include_in_schema=False)
public = APIRouter(dependencies=[NoStore], include_in_schema=False)
api = APIRouter(dependencies=[AdminDep, NoStore], include_in_schema=False)
_PAGE = Path(__file__).with_name("dashboard.html")
_SECURITY_HEADERS = {
    "Cache-Control": "no-store",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
}


class Decision(BaseModel):
    action: Literal["accept", "reject"]


class Login(BaseModel):
    username: Annotated[str, StringConstraints(max_length=64)]
    password: Annotated[str, StringConstraints(max_length=256)]


class FlagInput(BaseModel):
    enabled: bool


class DeleteInput(BaseModel):
    reason: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)] | None
    ) = None


class TutorialEditInput(TutorialEdit):
    title: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=5, max_length=120)
    ]
    summary: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=10, max_length=240)
    ]
    body: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=40, max_length=20000)
    ]
    category: Annotated[str, StringConstraints(pattern=r"^[a-z_]{3,24}$")]


@router.get("", response_class=HTMLResponse)
async def dashboard() -> HTMLResponse:
    # A página não tem dado nenhum: tudo vem das rotas, depois do login.
    return HTMLResponse(_PAGE.read_text(encoding="utf-8"), headers=_SECURITY_HEADERS)


@public.get("/session")
async def session(request: Request) -> dict[str, Any]:
    if not auth.enabled():
        return {"enabled": False, "user": None, "setup": auth.can_setup(request)}
    try:
        user = auth.require_admin(request)
    except Exception:  # noqa: BLE001 — sem sessão é só "não logado"
        user = None
    return {"enabled": True, "user": user}


@public.post("/login", status_code=204)
async def login(
    request: Request, response: Response, body: Login, service: AdminServiceDep
) -> None:
    if request.headers.get("X-Admin-Request") != "1":
        response.status_code = 403
        return
    auth.login(request, response, body.username, body.password)
    await service.record("login")


class Setup(BaseModel):
    username: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9._-]{3,64}$")]
    password: Annotated[str, StringConstraints(min_length=12, max_length=256)]


@public.post("/setup", status_code=204)
async def setup(
    request: Request, response: Response, body: Setup, service: AdminServiceDep
) -> None:
    if request.headers.get("X-Admin-Request") != "1":
        response.status_code = 403
        return
    auth.setup(request, body.username, body.password)
    auth.login(request, response, body.username, body.password)
    await service.record("setup")


@public.post("/logout", status_code=204)
async def logout(response: Response) -> None:
    auth.logout(response)


@api.get("/overview", response_model=Overview)
async def overview(service: AdminServiceDep) -> Overview:
    return await service.overview()


@api.get("/series", response_model=Series)
async def series(
    service: AdminServiceDep, days: Annotated[int, Query(ge=7, le=365)] = 30
) -> Series:
    return await service.series(days)


@api.get("/breakdown", response_model=Breakdown)
async def breakdown(service: AdminServiceDep) -> Breakdown:
    return await service.breakdown()


@api.get("/content/{kind}", response_model=Page)
async def content(
    service: AdminServiceDep,
    kind: ContentType,
    q: Annotated[SearchText | None, Query()] = None,
    status: Annotated[str | None, Query(pattern=r"^[a-z_]{3,16}$")] = None,
    subject: Annotated[str | None, Query(pattern=r"^[A-Za-z0-9]{3,16}$")] = None,
    days: Annotated[int | None, Query(ge=1, le=3650)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> Page:
    return await service.content(
        kind,
        q=q,
        status=status,
        subject=subject,
        days=days,
        page=page,
        page_size=page_size,
    )


@api.get("/content/{kind}/{content_id}")
async def detail(
    service: AdminServiceDep, kind: ContentType, content_id: UUID
) -> dict[str, Any]:
    return await service.detail(kind, content_id)


@api.delete("/content/{kind}/{content_id}", status_code=204)
async def delete_content(
    service: AdminServiceDep,
    kind: ContentType,
    content_id: UUID,
    body: DeleteInput | None = None,
) -> None:
    await service.delete(kind, content_id, body.reason if body else None)


@api.get("/materials/{material_id}/file")
async def material_file(service: AdminServiceDep, material_id: UUID) -> Response:
    material, data = await service.material_file(material_id)
    return Response(
        data,
        media_type=material.mime,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(material.filename)}",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox",
            "Cache-Control": "no-store",
        },
    )


@api.get("/reports", response_model=list[ReportView])
async def reports(
    service: AdminServiceDep,
    status: Annotated[Literal["pending", "accepted", "rejected"], Query()] = "pending",
) -> list[ReportView]:
    return await service.reports(status)


@api.post("/reports/{report_id}", status_code=204)
async def decide_report(
    service: AdminServiceDep, report_id: UUID, body: Decision
) -> None:
    await service.resolve_report(report_id, body.action == "accept")


@api.get("/tutorials", response_model=list[TutorialView])
async def tutorials(
    service: AdminServiceDep,
    status: Annotated[Literal["pending", "approved", "rejected"], Query()] = "pending",
) -> list[TutorialView]:
    return await service.tutorials(status)


@api.post("/tutorials/{tutorial_id}", status_code=204)
async def decide_tutorial(
    service: AdminServiceDep, tutorial_id: UUID, body: Decision
) -> None:
    await service.review_tutorial(tutorial_id, body.action == "accept")


@api.put("/tutorials/{tutorial_id}", status_code=204)
async def edit_tutorial(
    service: AdminServiceDep, tutorial_id: UUID, body: TutorialEditInput
) -> None:
    await service.edit_tutorial(tutorial_id, body)


@api.put("/flags/{key}")
async def set_flag(
    service: AdminServiceDep,
    key: Annotated[str, Field(pattern=r"^[a-z]{3,16}$")],
    body: FlagInput,
) -> dict[str, bool]:
    return await service.set_flag(key, body.enabled)


class MenuInput(BaseModel):
    visible: bool


class TextInput(BaseModel):
    # só link https (ou vazio, que esconde o botão de abrir)
    value: Annotated[
        str,
        StringConstraints(
            strip_whitespace=True, max_length=300, pattern=r"^(https://[^\s<>\"']+)?$"
        ),
    ]


@api.put("/menu/{key}")
async def set_menu(
    service: AdminServiceDep,
    key: Annotated[str, Field(pattern=r"^[a-z]{3,20}$")],
    body: MenuInput,
) -> dict[str, bool]:
    return await service.set_menu(key, body.visible)


@api.put("/texts/{key}")
async def set_text(
    service: AdminServiceDep,
    key: Annotated[str, Field(pattern=r"^[a-z_]{3,32}$")],
    body: TextInput,
) -> dict[str, str]:
    return await service.set_text(key, body.value)


@api.post("/maintenance")
async def maintenance(service: AdminServiceDep) -> dict[str, int]:
    return await service.maintenance()


@api.get("/log", response_model=list[LogEntry])
async def admin_log(service: AdminServiceDep) -> list[LogEntry]:
    return await service.log_entries()


router.include_router(public, prefix="/api")
router.include_router(api, prefix="/api")
