"""Sessões administrativas revogáveis; somente MFA completo concede acesso."""

import hashlib
from datetime import UTC, datetime, timedelta
from ipaddress import ip_address
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import select

from api.cookies import decrypt_cookie
from api.core.config import settings
from api.db.main import DatabaseDep
from api.modules.admin.models import AdminAccount, AdminSession
from api.modules.admin.passwords import MIN_PASSWORD, hash_password, verify_password  # noqa: F401
from api.modules.admin.permissions import Permission, Principal, allowed

ADMIN_COOKIE = "admin_session"
PENDING_COOKIE = "admin_pending"
SESSION_HOURS = 4


def enabled() -> bool:
    return bool(settings.admin_username and settings.admin_password_hash)


def _client(request: Request) -> str:
    host = request.client.host if request.client else "?"
    try:
        address = ip_address(host)
        return str(getattr(address, "ipv4_mapped", None) or address)
    except ValueError:
        return host


def can_setup(request: Request) -> bool:
    return (
        not enabled()
        and settings.environment != "production"
        and _client(request) in {"127.0.0.1", "::1", "localhost"}
    )


def check_admin_request(request: Request) -> None:
    if request.headers.get("X-Admin-Request") != "1":
        raise HTTPException(403, "Requisição recusada.")


async def require_admin(request: Request, db: DatabaseDep) -> Principal:
    if request.method not in {"GET", "HEAD"}:
        check_admin_request(request)
    token = request.cookies.get(ADMIN_COOKIE)
    claims = decrypt_cookie(ADMIN_COOKIE, token) if token else None
    try:
        account_id = UUID(claims["sub"]) if claims else None
        secret = claims["sid"] if claims else None
    except ValueError, KeyError, TypeError:
        raise HTTPException(
            401, "Faça login no painel com MFA.", headers={"X-Admin-Session": "expired"}
        ) from None
    if not account_id or not isinstance(secret, str):
        raise HTTPException(
            401, "Faça login no painel com MFA.", headers={"X-Admin-Session": "expired"}
        )

    async def read(session):
        account = await session.get(AdminAccount, account_id)
        active = await session.scalar(
            select(AdminSession).where(
                AdminSession.token_hash == hashlib.sha256(secret.encode()).hexdigest()
            )
        )
        if (
            not account
            or not active
            or active.account_id != account.id
            or not account.enabled
            or not account.totp_confirmed
            or active.revoked
            or active.expires_at <= datetime.now(UTC)
            or active.session_version != account.session_version
        ):
            return None
        return Principal(
            account.id, account.username, account.role, active.id, active.created_at
        )

    principal = await db.read(read)
    if principal is None:
        raise HTTPException(
            401,
            "Sessão expirada ou revogada. Entre novamente com MFA.",
            headers={"X-Admin-Session": "expired"},
        )
    request.state.admin = principal
    return principal


def require_permission(permission: Permission):
    async def check(
        principal: Annotated[Principal, Depends(require_admin)],
    ) -> Principal:
        if not allowed(principal.role, permission):
            raise HTTPException(403, "Seu cargo não permite esta operação.")
        if permission in {
            "accounts",
            "owner",
            "maintenance",
            "configure",
        } and datetime.now(UTC) - principal.authenticated_at > timedelta(minutes=15):
            raise HTTPException(
                403, "Entre novamente com MFA para executar esta operação sensível."
            )
        return principal

    return Depends(check)


def logout(response: Response) -> None:
    for name in (ADMIN_COOKIE, PENDING_COOKIE):
        response.delete_cookie(name, samesite="strict")


AdminDep = Depends(require_admin)
AdminUser = Annotated[Principal, AdminDep]
