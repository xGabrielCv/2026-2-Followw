"""Tetos ajustáveis da comunidade; a administração só pode reduzir os máximos seguros."""

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import SystemText

KEY = "community_limits"


class CommunityLimits(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    materials_file_mb: int = Field(default=20, ge=1, le=20)
    materials_per_subject: int = Field(default=50, ge=1, le=50)
    materials_subject_mb: int = Field(default=100, ge=1, le=100)
    forum_replies: int = Field(default=500, ge=1, le=500)
    tutorials_pending: int = Field(default=60, ge=1, le=60)


async def read_limits(session: AsyncSession) -> CommunityLimits:
    row = await session.get(SystemText, KEY)
    try:
        return (
            CommunityLimits.model_validate_json(row.value) if row else CommunityLimits()
        )
    except ValidationError:
        raise HTTPException(
            503, "Os limites da comunidade precisam ser conferidos pela administração."
        ) from None
