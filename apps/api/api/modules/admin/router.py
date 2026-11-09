from pathlib import Path
from time import perf_counter
from typing import Annotated, Any, Literal
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import text

from api import metrics
from api.cache import NoStore
from api.db.context import set_context
from api.modules.admin import auth
from api.modules.admin.accounts import AdminAccountsDep
from api.modules.admin.auth import AdminDep
from api.modules.admin.health import pool_status, resilience_status
from api.modules.admin.permissions import PERMISSIONS, Role
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


async def admin_scope() -> None:
    """Tudo em /admin roda no escopo administrativo do banco (RLS das tabelas de administração)."""
    set_context(scope="admin")


router = APIRouter(include_in_schema=False, dependencies=[Depends(admin_scope)])
public = APIRouter(dependencies=[NoStore], include_in_schema=False)
api = APIRouter(dependencies=[AdminDep, NoStore], include_in_schema=False)
_PAGE = Path(__file__).with_name("dashboard.html")
_SECURITY_HEADERS = {
    "Cache-Control": "no-store",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
}


class Decision(BaseModel):
    action: Literal["accept", "reject"]


class Login(BaseModel):
    model_config = ConfigDict(extra="forbid")
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


@router.get("/assets/{filename}")
async def dashboard_asset(
    filename: Literal[
        "dashboard.css",
        "dashboard.js",
        "dashboard-core.js",
        "dashboard-auth.js",
        "dashboard-accounts.js",
        "dashboard-support.js",
    ],
) -> Response:
    return Response(
        _PAGE.with_name(filename).read_text(encoding="utf-8"),
        media_type="text/css" if filename.endswith(".css") else "text/javascript",
        headers=_SECURITY_HEADERS,
    )


@public.get("/session")
async def session(request: Request, accounts: AdminAccountsDep) -> dict[str, Any]:
    result = await accounts.status(request)
    try:
        actor = await auth.require_admin(request, accounts.db)
        user = {
            "id": str(actor.id),
            "username": actor.username,
            "role": actor.role,
            "permissions": sorted(PERMISSIONS[actor.role]),
        }
    except HTTPException:
        user = None
    return {**result, "user": user}


@public.post("/login")
async def login(
    request: Request, response: Response, body: Login, accounts: AdminAccountsDep
) -> dict:
    return await accounts.login(request, response, body.username, body.password)


class Setup(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: Annotated[
        str, StringConstraints(pattern=r"^[A-Za-z][A-Za-z0-9._-]{2,63}$")
    ]
    password: Annotated[str, StringConstraints(min_length=12, max_length=256)]


@public.post("/setup")
async def setup(
    request: Request, response: Response, body: Setup, accounts: AdminAccountsDep
) -> dict:
    return await accounts.setup(request, response, body.username, body.password)


@public.post("/logout", status_code=204)
async def logout(
    request: Request, response: Response, accounts: AdminAccountsDep
) -> None:
    await accounts.logout(request, response)


class Factor(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: Annotated[
        str,
        StringConstraints(
            strip_whitespace=True, pattern=r"^(?:[0-9]{6}|[a-f0-9]{64})$"
        ),
    ]


@public.get("/mfa/enroll")
async def enrollment(request: Request, accounts: AdminAccountsDep) -> dict:
    return await accounts.enrollment(request)


@public.post("/mfa/confirm")
async def confirm_mfa(
    request: Request, response: Response, body: Factor, accounts: AdminAccountsDep
) -> dict:
    return await accounts.verify(request, response, body.code, enroll=True)


@public.post("/mfa/verify")
async def verify_mfa(
    request: Request, response: Response, body: Factor, accounts: AdminAccountsDep
) -> dict:
    return await accounts.verify(request, response, body.code)


@api.get(
    "/overview",
    dependencies=[auth.require_permission("operations")],
    response_model=Overview,
)
async def overview(service: AdminServiceDep) -> Overview:
    return await service.overview()


@api.get(
    "/series",
    dependencies=[auth.require_permission("operations")],
    response_model=Series,
)
async def series(
    service: AdminServiceDep, days: Annotated[int, Query(ge=7, le=365)] = 30
) -> Series:
    return await service.series(days)


@api.get(
    "/breakdown",
    dependencies=[auth.require_permission("operations")],
    response_model=Breakdown,
)
async def breakdown(service: AdminServiceDep) -> Breakdown:
    return await service.breakdown()


@api.get(
    "/content/{kind}",
    dependencies=[auth.require_permission("moderate")],
    response_model=Page,
)
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


@api.get(
    "/content/{kind}/{content_id}", dependencies=[auth.require_permission("moderate")]
)
async def detail(
    service: AdminServiceDep, kind: ContentType, content_id: UUID
) -> dict[str, Any]:
    return await service.detail(kind, content_id)


@api.delete(
    "/content/{kind}/{content_id}",
    dependencies=[auth.require_permission("moderate")],
    status_code=204,
)
async def delete_content(
    service: AdminServiceDep,
    kind: ContentType,
    content_id: UUID,
    body: DeleteInput | None = None,
) -> None:
    await service.delete(kind, content_id, body.reason if body else None)


@api.get(
    "/materials/{material_id}/file", dependencies=[auth.require_permission("moderate")]
)
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


@api.get(
    "/reports",
    dependencies=[auth.require_permission("moderate")],
    response_model=list[ReportView],
)
async def reports(
    service: AdminServiceDep,
    status: Annotated[Literal["pending", "accepted", "rejected"], Query()] = "pending",
) -> list[ReportView]:
    return await service.reports(status)


@api.post(
    "/reports/{report_id}",
    dependencies=[auth.require_permission("moderate")],
    status_code=204,
)
async def decide_report(
    service: AdminServiceDep, report_id: UUID, body: Decision
) -> None:
    await service.resolve_report(report_id, body.action == "accept")


@api.get(
    "/tutorials",
    dependencies=[auth.require_permission("moderate")],
    response_model=list[TutorialView],
)
async def tutorials(
    service: AdminServiceDep,
    status: Annotated[Literal["pending", "approved", "rejected"], Query()] = "pending",
) -> list[TutorialView]:
    return await service.tutorials(status)


@api.post(
    "/tutorials/{tutorial_id}",
    dependencies=[auth.require_permission("moderate")],
    status_code=204,
)
async def decide_tutorial(
    service: AdminServiceDep, tutorial_id: UUID, body: Decision
) -> None:
    await service.review_tutorial(tutorial_id, body.action == "accept")


@api.put(
    "/tutorials/{tutorial_id}",
    dependencies=[auth.require_permission("moderate")],
    status_code=204,
)
async def edit_tutorial(
    service: AdminServiceDep, tutorial_id: UUID, body: TutorialEditInput
) -> None:
    await service.edit_tutorial(tutorial_id, body)


@api.put("/flags/{key}", dependencies=[auth.require_permission("configure")])
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


@api.put("/menu/{key}", dependencies=[auth.require_permission("configure")])
async def set_menu(
    service: AdminServiceDep,
    key: Annotated[str, Field(pattern=r"^[a-z]{3,20}$")],
    body: MenuInput,
) -> dict[str, bool]:
    return await service.set_menu(key, body.visible)


@api.put("/texts/{key}", dependencies=[auth.require_permission("configure")])
async def set_text(
    service: AdminServiceDep,
    key: Annotated[str, Field(pattern=r"^[a-z_]{3,32}$")],
    body: TextInput,
) -> dict[str, str]:
    return await service.set_text(key, body.value)


@api.post("/maintenance", dependencies=[auth.require_permission("maintenance")])
async def maintenance(service: AdminServiceDep) -> dict[str, int]:
    return await service.maintenance()


@api.get(
    "/log",
    dependencies=[auth.require_permission("audit")],
    response_model=list[LogEntry],
)
async def admin_log(service: AdminServiceDep) -> list[LogEntry]:
    return await service.log_entries()


class AccountCreate(Setup):
    role: Role


class AccountChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Role | None = None
    enabled: bool | None = None


class StrongFactor(Factor):
    password: Annotated[str, StringConstraints(min_length=12, max_length=256)]


@api.get("/accounts", dependencies=[auth.require_permission("accounts")])
async def accounts_list(accounts: AdminAccountsDep) -> list[dict]:
    return await accounts.list()


@api.post(
    "/accounts", dependencies=[auth.require_permission("accounts")], status_code=201
)
async def account_create(
    request: Request, body: AccountCreate, accounts: AdminAccountsDep
) -> dict:
    return await accounts.create(
        request.state.admin, body.username, body.password, body.role
    )


@api.patch("/accounts/{account_id}", dependencies=[auth.require_permission("accounts")])
async def account_change(
    request: Request, account_id: UUID, body: AccountChange, accounts: AdminAccountsDep
) -> dict:
    return await accounts.change(
        request.state.admin, account_id, enabled=body.enabled, role=body.role
    )


@api.delete(
    "/accounts/{account_id}",
    dependencies=[auth.require_permission("accounts")],
    status_code=204,
)
async def account_remove(
    request: Request, account_id: UUID, accounts: AdminAccountsDep
) -> None:
    await accounts.change(request.state.admin, account_id, enabled=False)


@api.post(
    "/accounts/{account_id}/revoke",
    dependencies=[auth.require_permission("accounts")],
    status_code=204,
)
async def revoke_sessions(
    request: Request, account_id: UUID, accounts: AdminAccountsDep
) -> None:
    await accounts.revoke(request.state.admin, account_id)


@api.post("/accounts/{account_id}/mfa/reset")
async def reset_mfa(
    request: Request,
    response: Response,
    account_id: UUID,
    body: StrongFactor,
    accounts: AdminAccountsDep,
) -> dict:
    return await accounts.reset_mfa(
        request.state.admin, account_id, body.password, body.code, request, response
    )


@api.post(
    "/ownership/{account_id}",
    dependencies=[auth.require_permission("owner")],
    status_code=204,
)
async def transfer_owner(
    request: Request, account_id: UUID, body: StrongFactor, accounts: AdminAccountsDep
) -> None:
    await accounts.transfer(request.state.admin, account_id, body.password, body.code)


@api.get("/moderation/summary", dependencies=[auth.require_permission("moderate")])
async def moderation_summary(service: AdminServiceDep) -> dict:
    return {
        "reports": len(await service.reports("pending")),
        "tutorials": len(await service.tutorials("pending")),
    }


@api.post("/self/recovery-codes")
async def own_recovery(
    request: Request, body: StrongFactor, accounts: AdminAccountsDep
) -> dict:
    return await accounts.own_recovery_codes(
        request.state.admin, body.password, body.code
    )


@api.post("/self/revoke", status_code=204)
async def revoke_self(
    request: Request, response: Response, accounts: AdminAccountsDep
) -> None:
    await accounts.revoke_self(request.state.admin, response)


@api.get("/health", dependencies=[auth.require_permission("operations")])
async def health(accounts: AdminAccountsDep) -> dict:
    started = perf_counter()
    await accounts.db.read(lambda session: session.scalar(text("SELECT 1")))
    return {
        "postgresql": {
            "state": "healthy",
            "latency_ms": round((perf_counter() - started) * 1000, 2),
        },
        "metrics": metrics.snapshot(),
        "origins": resilience_status(),
        "pool": pool_status(),
        "backups": {"state": "operator_managed", "last_verified": None},
    }


@api.post(
    "/metrics/reset", dependencies=[auth.require_permission("owner")], status_code=204
)
async def reset_metrics(service: AdminServiceDep) -> None:
    await service.record("admin.operational_metrics_reset")
    metrics.reset()


from api.modules.support.staff import router as tickets_router

api.include_router(tickets_router, prefix="/tickets")
router.include_router(public, prefix="/api")
router.include_router(api, prefix="/api")
