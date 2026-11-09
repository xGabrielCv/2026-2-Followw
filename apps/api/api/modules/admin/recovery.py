from anyio import to_thread
from sqlalchemy import func, select, text, update

from api.modules.admin.models import AdminAccount, AdminSession
from api.modules.admin.passwords import hash_password
from api.modules.admin.service import log


async def configure_owner(
    sessions, username: str, password: str, *, recover: bool = False
) -> None:
    """Somente CLI local: cria o primeiro Owner ou recupera a conta explicitamente indicada."""
    digest = await to_thread.run_sync(hash_password, password)
    async with sessions.begin() as session:
        await session.execute(text("SELECT pg_advisory_xact_lock(865942118)"))
        account = await session.scalar(
            select(AdminAccount)
            .where(AdminAccount.username == username)
            .with_for_update()
        )
        count = await session.scalar(select(func.count()).select_from(AdminAccount))
        if account is None:
            if recover or count:
                raise ValueError(
                    "Owner não encontrado. Informe o pseudônimo existente."
                )
            account = AdminAccount(
                username=username, password_hash=digest, role="owner"
            )
            session.add(account)
            await session.flush()
            action = "admin.local_owner_created"
        else:
            if account.role != "owner":
                raise ValueError(
                    "A recuperação local é exclusiva do Owner; gerencie a equipe pelo painel."
                )
            account.password_hash = digest
            account.enabled = True
            account.session_version += 1
            account.failed_attempts = 0
            account.locked_until = None
            account.pending_nonce_hash = None
            await session.execute(
                update(AdminSession)
                .where(AdminSession.account_id == account.id)
                .values(revoked=True)
            )
            action = "admin.local_password_changed"
            if recover:
                account.totp_secret = None
                account.totp_confirmed = False
                account.last_totp_counter = -1
                account.recovery_hashes = []
                action = "admin.local_recovery"
        await log(
            session,
            action,
            target_type="admin_account",
            target_id=account.id,
            actor=account,
        )
