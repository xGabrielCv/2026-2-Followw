"""Aviso operacional público opcional configurado no painel administrativo."""

import hashlib
import json
from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy.ext.asyncio import AsyncSession

from api.db.models import SystemText

BANNER_KEY = "system_banner"
BannerLevel = Literal["info", "warning"]


class SystemBannerInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    level: BannerLevel = "info"
    title: Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)] = ""
    message: Annotated[
        str, StringConstraints(strip_whitespace=True, max_length=280)
    ] = ""
    expires_at: datetime | None = None


class SystemBannerConfig(BaseModel):
    enabled: bool = False
    level: BannerLevel = "info"
    title: str = ""
    message: str = ""
    expires_at: datetime | None = None
    id: str = ""


class PublicBanner(BaseModel):
    id: str
    level: BannerLevel
    title: str
    message: str
    expires_at: datetime | None = None


def _banner_id(
    level: str, title: str, message: str, expires_at: datetime | None
) -> str:
    raw = f"{level}|{title}|{message}|{expires_at.isoformat() if expires_at else ''}"
    return hashlib.sha256(raw.encode()).hexdigest()[:12]


async def read_banner_config(session: AsyncSession) -> SystemBannerConfig:
    row = await session.get(SystemText, BANNER_KEY)
    if row is None or not row.value:
        return SystemBannerConfig()
    try:
        parsed = SystemBannerConfig.model_validate(json.loads(row.value))
    except Exception:  # noqa: BLE001
        return SystemBannerConfig()
    if parsed.expires_at is not None and parsed.expires_at.tzinfo is None:
        parsed = parsed.model_copy(
            update={"expires_at": parsed.expires_at.replace(tzinfo=UTC)}
        )
    return parsed


async def public_banner(session: AsyncSession) -> PublicBanner | None:
    cfg = await read_banner_config(session)
    if not cfg.enabled or not cfg.title or not cfg.message:
        return None
    if cfg.expires_at is not None and cfg.expires_at <= datetime.now(UTC):
        return None
    banner_id = cfg.id or _banner_id(cfg.level, cfg.title, cfg.message, cfg.expires_at)
    return PublicBanner(
        id=banner_id,
        level=cfg.level,
        title=cfg.title,
        message=cfg.message,
        expires_at=cfg.expires_at,
    )


async def save_banner_config(
    session: AsyncSession, body: SystemBannerInput
) -> SystemBannerConfig:
    expires = body.expires_at
    if expires is not None and expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)
    banner_id = (
        _banner_id(body.level, body.title, body.message, expires)
        if body.title and body.message
        else ""
    )
    saved = SystemBannerConfig(
        enabled=body.enabled and bool(body.title and body.message),
        level=body.level,
        title=body.title,
        message=body.message,
        expires_at=expires,
        id=banner_id,
    )
    payload = json.dumps(saved.model_dump(mode="json"), ensure_ascii=False)
    row = await session.get(SystemText, BANNER_KEY)
    if row is None:
        session.add(SystemText(key=BANNER_KEY, value=payload))
    else:
        row.value = payload
    await session.flush()
    return saved
