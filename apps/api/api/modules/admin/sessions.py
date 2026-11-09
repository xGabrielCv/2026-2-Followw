import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from api.cookies import decrypt_cookie, encrypt_cookie
from api.core.config import settings
from api.modules.admin.auth import ADMIN_COOKIE, PENDING_COOKIE, SESSION_HOURS
from api.modules.admin.models import AdminAccount, AdminSession


def set_admin_cookie(response: Response, name: str, claims: dict, seconds: int) -> None:
    token = encrypt_cookie(
        name, {**claims, "exp": int(datetime.now(UTC).timestamp()) + seconds}
    )
    response.set_cookie(
        name,
        token,
        max_age=seconds,
        httponly=True,
        samesite="strict",
        secure=settings.environment == "production",
    )


def challenge(response: Response, account: AdminAccount) -> str:
    stage = "verify" if account.totp_confirmed else "enroll"
    nonce = secrets.token_hex(32)
    account.pending_nonce_hash = hashlib.sha256(nonce.encode()).hexdigest()
    set_admin_cookie(
        response,
        PENDING_COOKIE,
        {
            "sub": str(account.id),
            "version": account.session_version,
            "stage": stage,
            "nonce": nonce,
        },
        300,
    )
    return stage


async def pending_account(
    session: AsyncSession, request: Request, stage: str
) -> AdminAccount:
    token = request.cookies.get(PENDING_COOKIE)
    claims = decrypt_cookie(PENDING_COOKIE, token) if token else None
    try:
        id_ = UUID(claims["sub"]) if claims else None
    except ValueError, KeyError, TypeError:
        id_ = None
    account = (
        await session.get(AdminAccount, id_, with_for_update=True) if id_ else None
    )
    if (
        not claims
        or not account
        or not account.enabled
        or account.session_version != claims.get("version")
        or not hmac.compare_digest(
            account.pending_nonce_hash or "",
            hashlib.sha256(str(claims.get("nonce", "")).encode()).hexdigest(),
        )
        or claims.get("stage") != stage
        or (stage == "enroll" and account.totp_confirmed)
    ):
        raise HTTPException(401, "Confirme a senha novamente para prosseguir.")
    return account


async def issue_session(
    session: AsyncSession, response: Response, account: AdminAccount
) -> None:
    secret = secrets.token_hex(32)
    account.pending_nonce_hash = None
    session.add(
        AdminSession(
            account_id=account.id,
            token_hash=hashlib.sha256(secret.encode()).hexdigest(),
            session_version=account.session_version,
            expires_at=datetime.now(UTC) + timedelta(hours=SESSION_HOURS),
        )
    )
    set_admin_cookie(
        response,
        ADMIN_COOKIE,
        {"sub": str(account.id), "sid": secret},
        SESSION_HOURS * 3600,
    )
    response.delete_cookie(PENDING_COOKIE, samesite="strict")
