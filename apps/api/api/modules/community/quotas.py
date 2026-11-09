import time
from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from api.anonymous import anonymous_key
from api.community_limits import read_limits
from api.db.context import set_context
from api.db.main import Database
from api.db.models import Subject
from api.modules.community.models import UploadBudget

MAX_DAILY_UPLOAD_ATTEMPTS = 10
DAY_SECONDS = 86400


async def reserve_upload(db: Database, code: str, key: str) -> None:
    now = int(time.time())
    day = now // DAY_SECONDS
    expires_at = datetime.fromtimestamp((day + 1) * DAY_SECONDS, UTC)
    digest = anonymous_key(key, f"upload-budget:{code}:{day}")
    set_context(scope="upload_budget")

    async def reserve(session):
        limit = min(
            MAX_DAILY_UPLOAD_ATTEMPTS,
            (await read_limits(session)).upload_attempts_per_day,
        )
        if (
            await session.scalar(select(Subject.code).where(Subject.code == code))
            is None
        ):
            raise HTTPException(404, "Matéria não encontrada.")
        await session.execute(
            delete(UploadBudget).where(UploadBudget.expires_at <= datetime.now(UTC))
        )
        reserved = await session.scalar(
            insert(UploadBudget)
            .values(digest=digest, count=1, expires_at=expires_at)
            .on_conflict_do_update(
                index_elements=[UploadBudget.digest],
                set_={"count": UploadBudget.count + 1},
                where=UploadBudget.count < limit,
            )
            .returning(UploadBudget.count)
        )
        return reserved, limit

    reserved, limit = await db.write(reserve)
    if reserved is None:
        raise HTTPException(
            429,
            f"As {limit} autorizações de envio desta matéria neste navegador foram usadas hoje. Tente amanhã.",
            headers={"Retry-After": str((day + 1) * DAY_SECONDS - now)},
        )
