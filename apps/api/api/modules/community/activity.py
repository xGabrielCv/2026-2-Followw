"""Última exclusão pública em hora cheia: sem pessoa, conteúdo ou identificador da publicação."""

from typing import Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

Resource = Literal["forum", "materials", "reviews", "groups", "tutorials", "reports"]


async def record_deletion(session: AsyncSession, resource: Resource) -> None:
    await session.flush()
    await session.execute(
        text("SELECT followw_record_public_activity(:resource)"), {"resource": resource}
    )
