import base64
import secrets
from datetime import UTC, datetime, timedelta
from io import BytesIO
from typing import Annotated
from uuid import UUID

import pyotp
import qrcode
import qrcode.image.svg
from anyio import CapacityLimiter, to_thread
from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import func, select, text, update

from api.core.config import settings
from api.db.main import DatabaseDep
from api.modules.admin import auth
from api.modules.admin.mfa import consume_recovery, recovery_codes, totp_counter
from api.modules.admin.models import AdminAccount, AdminSession
from api.modules.admin.passwords import hash_password, verify_password
from api.modules.admin.permissions import PERMISSIONS, Principal, Role
from api.modules.admin.service import log
from api.modules.admin.sessions import challenge, issue_session, pending_account
from api.rate_limit import _limit, _retry_headers

_HASH_LIMIT = CapacityLimiter(2)
_DUMMY_HASH = hash_password(secrets.token_hex(32))


async def password_matches(password: str, digest: str) -> bool:
    return await to_thread.run_sync(
        verify_password, password, digest, limiter=_HASH_LIMIT
    )


def account_view(account: AdminAccount) -> dict:
    return {
        "id": str(account.id),
        "username": account.username,
        "role": account.role,
        "enabled": account.enabled,
        "mfa": account.totp_confirmed,
        "created_at": account.created_at,
    }


async def _quota(request: Request, username: str) -> None:
    for group, key in [
        ("admin-account", username.lower()),
        ("admin-ip", auth._client(request)),
    ]:
        result = await _limit(group, key, 5 if group == "admin-account" else 30, 900)
        if not result.allowed:
            raise HTTPException(
                429,
                "Muitas tentativas. Espere antes de tentar novamente.",
                headers=_retry_headers(result),
            )


def _locked(account: AdminAccount) -> bool:
    return account.locked_until is not None and account.locked_until > datetime.now(UTC)


async def _failed(session, account: AdminAccount) -> None:
    if account.locked_until and account.locked_until <= datetime.now(UTC):
        account.failed_attempts = 0
    account.failed_attempts += 1
    if account.failed_attempts >= 5:
        account.locked_until = datetime.now(UTC) + timedelta(minutes=15)
    await log(
        session,
        "admin.authentication_failed",
        target_type="admin_account",
        target_id=account.id,
    )


class AdminAccounts:
    def __init__(self, db: DatabaseDep) -> None:
        self.db = db

    async def status(self, request: Request) -> dict:
        exists = await self.db.read(
            lambda session: session.scalar(
                select(func.count()).select_from(AdminAccount)
            )
        )
        return {
            "enabled": bool(exists or auth.enabled()),
            "setup": not exists and auth.can_setup(request),
        }

    async def setup(
        self, request: Request, response: Response, username: str, password: str
    ) -> dict:
        auth.check_admin_request(request)
        if not auth.can_setup(request):
            raise HTTPException(
                403, "Cadastro disponível somente no primeiro acesso local."
            )
        auth.logout(response)
        digest = await to_thread.run_sync(hash_password, password, limiter=_HASH_LIMIT)

        async def write(session):
            await session.execute(text("SELECT pg_advisory_xact_lock(865942118)"))
            if await session.scalar(select(func.count()).select_from(AdminAccount)):
                raise HTTPException(409, "A instalação já possui Owner.")
            account = AdminAccount(
                username=username,
                password_hash=digest,
                role="owner",
                totp_secret=pyotp.random_base32(),
            )
            session.add(account)
            await session.flush()
            await log(
                session,
                "admin.owner_created",
                target_type="admin_account",
                target_id=account.id,
                actor=account,
            )
            return {"stage": challenge(response, account)}

        return await self.db.write(write)

    async def login(
        self, request: Request, response: Response, username: str, password: str
    ) -> dict:
        auth.check_admin_request(request)
        await _quota(request, username)
        await self.logout(request, response)

        async def write(session):
            account = await session.scalar(
                select(AdminAccount)
                .where(AdminAccount.username == username)
                .with_for_update()
            )
            # Importa a credencial legada somente mediante sua própria senha, uma única vez.
            if (
                account is None
                and auth.enabled()
                and username == settings.admin_username
            ):
                await session.execute(text("SELECT pg_advisory_xact_lock(865942118)"))
                account = await session.scalar(
                    select(AdminAccount)
                    .where(AdminAccount.username == username)
                    .with_for_update()
                )
                if (
                    account is None
                    and not await session.scalar(
                        select(func.count()).select_from(AdminAccount)
                    )
                    and await password_matches(
                        password, settings.admin_password_hash or ""
                    )
                ):
                    account = AdminAccount(
                        username=username,
                        password_hash=await to_thread.run_sync(
                            hash_password, password, limiter=_HASH_LIMIT
                        ),
                        role="owner",
                    )
                    session.add(account)
                    await session.flush()
                    await log(
                        session,
                        "admin.legacy_owner_imported",
                        target_type="admin_account",
                        target_id=account.id,
                        actor=account,
                    )
            valid = await password_matches(
                password, account.password_hash if account else _DUMMY_HASH
            )
            if account and _locked(account):
                return {"error": 429}
            if not account or not account.enabled or not valid:
                if account:
                    await _failed(session, account)
                return {"error": 401}
            if account.password_hash.startswith("scrypt$"):
                account.password_hash = await to_thread.run_sync(
                    hash_password, password, limiter=_HASH_LIMIT
                )
            if not account.totp_confirmed and not account.totp_secret:
                account.totp_secret = pyotp.random_base32()
            return {"stage": challenge(response, account)}

        result = await self.db.write(write)
        if "error" in result:
            raise HTTPException(
                result["error"],
                "Não foi possível autenticar. Confira suas credenciais ou aguarde o bloqueio temporário.",
            )
        return result

    async def enrollment(self, request: Request) -> dict:
        async def write(session):
            account = await pending_account(session, request, "enroll")
            if _locked(account):
                raise HTTPException(429, "Conta temporariamente bloqueada.")
            if not account.totp_secret:
                raise HTTPException(401, "Entre novamente para iniciar o cadastro MFA.")
            uri = pyotp.TOTP(account.totp_secret).provisioning_uri(
                account.username, issuer_name="Followw UnB"
            )
            image = qrcode.make(uri, image_factory=qrcode.image.svg.SvgPathImage)
            stream = BytesIO()
            image.save(stream)
            return {
                "uri": uri,
                "secret": account.totp_secret,
                "qr": "data:image/svg+xml;base64,"
                + base64.b64encode(stream.getvalue()).decode(),
            }

        return await self.db.write(write)

    async def verify(
        self, request: Request, response: Response, code: str, *, enroll: bool = False
    ) -> dict:
        auth.check_admin_request(request)

        async def write(session):
            account = await pending_account(
                session, request, "enroll" if enroll else "verify"
            )
            if _locked(account):
                return {"error": 429}
            counter = (
                totp_counter(account.totp_secret, code, account.last_totp_counter)
                if account.totp_secret
                else None
            )
            recovery = (
                consume_recovery(account.id, code, account.recovery_hashes)
                if not enroll and counter is None
                else None
            )
            if counter is None and recovery is None:
                await _failed(session, account)
                return {"error": 401}
            codes: list[str] = []
            if counter is not None:
                account.last_totp_counter = counter
            if recovery is not None:
                account.recovery_hashes = recovery
                await log(
                    session,
                    "admin.recovery_code_used",
                    target_type="admin_account",
                    target_id=account.id,
                    actor=account,
                )
            if enroll:
                account.totp_confirmed = True
                account.session_version += 1
                codes, account.recovery_hashes = recovery_codes(account.id)
            account.failed_attempts = 0
            account.locked_until = None
            await issue_session(session, response, account)
            await log(
                session,
                "admin.mfa_enrolled" if enroll else "admin.login",
                target_type="admin_account",
                target_id=account.id,
                actor=account,
            )
            return {
                "user": account_view(account),
                "permissions": sorted(PERMISSIONS[account.role]),
                "recovery_codes": codes,
            }

        result = await self.db.write(write)
        if "error" in result:
            raise HTTPException(
                result["error"],
                "Código incorreto, já utilizado ou bloqueio temporário.",
            )
        return result

    async def revoke(self, actor: Principal, target_id: UUID) -> None:
        async def write(session):
            target = await session.get(AdminAccount, target_id, with_for_update=True)
            self.can_manage(actor, target)
            target.session_version += 1
            await session.execute(
                update(AdminSession)
                .where(AdminSession.account_id == target.id)
                .values(revoked=True)
            )
            await log(
                session,
                "admin.sessions_revoked",
                target_type="admin_account",
                target_id=target.id,
                actor=actor,
            )

        await self.db.write(write)

    @staticmethod
    def can_manage(
        actor: Principal, target: AdminAccount | None, role: Role | None = None
    ) -> None:
        if target is None:
            raise HTTPException(404, "Conta não encontrada.")
        if target.role == "owner" or actor.id == target.id:
            raise HTTPException(
                403,
                "Use a operação específica da própria conta ou de transferência do Owner.",
            )
        if actor.role == "owner" and role != "owner":
            return
        if (
            actor.role == "administrator"
            and target.role == "moderator"
            and role in (None, "moderator")
        ):
            return
        raise HTTPException(403, "Seu cargo não permite administrar esta conta.")

    async def list(self) -> list[dict]:
        async def read(session):
            return [
                account_view(account)
                for account in await session.scalars(
                    select(AdminAccount).order_by(AdminAccount.created_at)
                )
            ]

        return await self.db.read(read)

    async def create(
        self, actor: Principal, username: str, password: str, role: Role
    ) -> dict:
        if (
            role == "owner"
            or actor.role not in {"owner", "administrator"}
            or (actor.role == "administrator" and role != "moderator")
        ):
            raise HTTPException(403, "Seu cargo não permite criar esta conta.")
        digest = await to_thread.run_sync(hash_password, password, limiter=_HASH_LIMIT)

        async def write(session):
            await session.execute(text("SELECT pg_advisory_xact_lock(865942118)"))
            if await session.scalar(
                select(AdminAccount.id).where(AdminAccount.username == username)
            ):
                raise HTTPException(409, "Pseudônimo já utilizado.")
            account = AdminAccount(username=username, password_hash=digest, role=role)
            session.add(account)
            await session.flush()
            await log(
                session,
                "admin.account_created",
                target_type="admin_account",
                target_id=account.id,
                detail=role,
                actor=actor,
            )
            return account_view(account)

        return await self.db.write(write)

    async def change(
        self,
        actor: Principal,
        target_id: UUID,
        *,
        enabled: bool | None = None,
        role: Role | None = None,
    ) -> dict:
        async def write(session):
            account = await session.get(AdminAccount, target_id, with_for_update=True)
            self.can_manage(actor, account, role)
            if enabled is not None:
                account.enabled = enabled
            if role:
                account.role = role
            account.session_version += 1
            await log(
                session,
                "admin.account_changed",
                target_type="admin_account",
                target_id=account.id,
                detail=f"role={account.role};enabled={account.enabled}",
                actor=actor,
            )
            return account_view(account)

        return await self.db.write(write)

    async def logout(self, request: Request, response: Response) -> None:
        auth.check_admin_request(request)
        try:
            actor = await auth.require_admin(request, self.db)
        except HTTPException:
            actor = None
        if actor:

            async def write(session):
                await session.execute(
                    update(AdminSession)
                    .where(AdminSession.id == actor.session_id)
                    .values(revoked=True)
                )
                await log(session, "admin.logout", actor=actor)

            await self.db.write(write)
        auth.logout(response)

    async def strengthen(self, actor: Principal, password: str, code: str) -> bool:
        async def write(session):
            account = await session.get(AdminAccount, actor.id, with_for_update=True)
            if not account or _locked(account):
                return False
            valid_password = await password_matches(password, account.password_hash)
            counter = (
                totp_counter(account.totp_secret, code, account.last_totp_counter)
                if account.totp_secret
                else None
            )
            recovery = (
                consume_recovery(account.id, code, account.recovery_hashes)
                if counter is None
                else None
            )
            if not valid_password or (counter is None and recovery is None):
                await _failed(session, account)
                return False
            if counter is not None:
                account.last_totp_counter = counter
            if recovery is not None:
                account.recovery_hashes = recovery
            return True

        return await self.db.write(write)

    async def own_recovery_codes(
        self, actor: Principal, password: str, code: str
    ) -> dict:
        if not await self.strengthen(actor, password, code):
            raise HTTPException(401, "Verificação reforçada recusada.")

        async def write(session):
            account = await session.get(AdminAccount, actor.id, with_for_update=True)
            codes, account.recovery_hashes = recovery_codes(account.id)
            await log(
                session,
                "admin.recovery_codes_rotated",
                target_type="admin_account",
                target_id=account.id,
                actor=actor,
            )
            return {"recovery_codes": codes}

        return await self.db.write(write)

    async def revoke_self(self, actor: Principal, response: Response) -> None:
        async def write(session):
            account = await session.get(AdminAccount, actor.id, with_for_update=True)
            account.session_version += 1
            await session.execute(
                update(AdminSession)
                .where(AdminSession.account_id == actor.id)
                .values(revoked=True)
            )
            await log(session, "admin.own_sessions_revoked", actor=actor)

        await self.db.write(write)
        auth.logout(response)

    async def reset_mfa(
        self,
        actor: Principal,
        target_id: UUID,
        password: str,
        code: str,
        request: Request,
        response: Response,
    ) -> dict:
        if actor.id != target_id and actor.role != "owner":
            raise HTTPException(403, "Somente o Owner redefine fatores de outra conta.")
        if not await self.strengthen(actor, password, code):
            raise HTTPException(401, "Verificação reforçada recusada.")

        async def write(session):
            account = await session.get(AdminAccount, target_id, with_for_update=True)
            if not account or (account.role == "owner" and actor.id != account.id):
                raise HTTPException(403, "Conta protegida.")
            account.totp_secret = None
            account.totp_confirmed = False
            account.last_totp_counter = -1
            account.recovery_hashes = []
            account.session_version += 1
            await session.execute(
                update(AdminSession)
                .where(AdminSession.account_id == account.id)
                .values(revoked=True)
            )
            await log(
                session,
                "admin.mfa_reset",
                target_type="admin_account",
                target_id=account.id,
                actor=actor,
            )
            if actor.id == account.id:
                auth.logout(response)
                return {"stage": challenge(response, account)}
            return {"stage": "password_required"}

        return await self.db.write(write)

    async def transfer(
        self, actor: Principal, target_id: UUID, password: str, code: str
    ) -> None:
        if actor.role != "owner" or target_id == actor.id:
            raise HTTPException(403, "Transferência reservada ao Owner atual.")
        if not await self.strengthen(actor, password, code):
            raise HTTPException(401, "Verificação reforçada recusada.")

        async def write(session):
            await session.execute(text("SELECT pg_advisory_xact_lock(865942118)"))
            current = await session.get(AdminAccount, actor.id, with_for_update=True)
            target = await session.get(AdminAccount, target_id, with_for_update=True)
            if (
                not current
                or current.role != "owner"
                or not target
                or not target.enabled
                or not target.totp_confirmed
            ):
                raise HTTPException(
                    409, "Destino precisa estar ativo e com MFA confirmado."
                )
            current.role = "administrator"
            current.session_version += 1
            await session.flush()
            target.role = "owner"
            target.session_version += 1
            await log(
                session,
                "admin.owner_transferred",
                target_type="admin_account",
                target_id=target.id,
                actor=actor,
            )

        await self.db.write(write)


AdminAccountsDep = Annotated[AdminAccounts, Depends()]
