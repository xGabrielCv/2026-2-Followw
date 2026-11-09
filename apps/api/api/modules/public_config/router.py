import hashlib
from typing import Annotated, Literal

from fastapi import APIRouter, Header, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.cache import NoStore
from api.cookies import ACCESS_COOKIE_NAME, PROFILE_COOKIE_NAME, REFRESH_COOKIE_NAME
from api.db.main import DatabaseDep
from api.db.models import (
    ClassroomGroup,
    ForumPost,
    ForumReply,
    Material,
    ProfessorReview,
    SharedStatistics,
    SystemFlag,
    SystemText,
    Tutorial,
)
from api.flags import flags, menu, texts
from api.metrics import observe_client_event
from api.rate_limit import publish_quota

router = APIRouter()


class TechnicalMetric(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event: Literal["login_session_lost"]


@router.post(
    "/metrics",
    status_code=204,
    dependencies=[NoStore, publish_quota("client_metrics", 60)],
)
async def receive_metric(
    request: Request,
    body: TechnicalMetric,
    db: DatabaseDep,
    consent: Annotated[Literal["1"] | None, Header(alias="X-Followw-Metrics")] = None,
) -> None:
    if any(
        name in request.cookies
        for name in (ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME, PROFILE_COOKIE_NAME)
    ):
        raise HTTPException(400, "Envie métricas sem cookies acadêmicos.")
    if consent == "1" and (await db.read(flags))["telemetry"]:
        observe_client_event(body.event)


class AppLinks(BaseModel):
    automatricula: str | None
    monitor: str | None


class AppConfig(BaseModel):
    """O que o app mostra: cartões do Mais ligados pelo admin e os links das ferramentas."""

    menu: dict[str, bool]
    links: AppLinks


@router.get(
    "",
    response_model=AppConfig,
    summary="Configuração pública do app (cartões do Mais e links das ferramentas)",
)
async def get_config(db: DatabaseDep, response: Response) -> AppConfig:
    async def read(session: AsyncSession) -> AppConfig:
        links = await texts(session)
        # ferramenta ligada sem link aparece como "em breve"
        return AppConfig(
            menu=await menu(session),
            links=AppLinks(
                automatricula=links["automatricula_url"] or None,
                monitor=links["monitor_url"] or None,
            ),
        )

    response.headers["Cache-Control"] = "public, max-age=60"
    return await db.read(read)


# Cada parte da nuvem tem sua versão: o app só relê a que mudou.
_PARTS = {
    "reviews": (ProfessorReview,),
    "groups": (ClassroomGroup,),
    "materials": (Material,),
    "forum": (ForumPost, ForumReply),
    "tutorials": (Tutorial,),
    "statistics": (SharedStatistics,),
    "config": (SystemFlag, SystemText),
}


class ContentVersion(BaseModel):
    """Uma impressão curta por parte do conteúdo (quantidade e última mudança)."""

    parts: dict[str, str]


@router.get(
    "/version",
    response_model=ContentVersion,
    summary="Versão do conteúdo da comunidade, para o app saber o que mudou",
)
async def get_version(db: DatabaseDep, response: Response) -> ContentVersion:
    async def read(session: AsyncSession) -> ContentVersion:
        parts = {}
        for name, models in _PARTS.items():
            stamp = []
            for model in models:
                count, changed = (
                    await session.execute(
                        select(func.count(), func.max(model.updated_at)).select_from(
                            model
                        )
                    )
                ).one()
                stamp.append(f"{count}:{changed}")
            parts[name] = hashlib.sha256("|".join(stamp).encode()).hexdigest()[:12]
        return ContentVersion(parts=parts)

    response.headers["Cache-Control"] = "no-cache"
    return await db.read(read)
