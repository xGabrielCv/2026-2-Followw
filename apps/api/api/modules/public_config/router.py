import hashlib
from typing import Annotated, Literal

from fastapi import APIRouter, Header, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, literal, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession
from unb_browser import SemesterCalendar

from api.academic_calendar import read_custom_calendar
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
from api.semester_alert import SemesterAlertConfig, read_alert

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
    """O que o app mostra: cartões do Mais, bandeiras públicas, calendário estendido e alerta."""

    menu: dict[str, bool]
    links: AppLinks
    flags: dict[str, bool]
    calendar: dict[str, SemesterCalendar]
    alert: SemesterAlertConfig


@router.get(
    "",
    response_model=AppConfig,
    summary="Configuração pública do app (cartões do Mais, bandeiras, calendário e alerta)",
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
            flags=await flags(session),
            calendar={
                key: SemesterCalendar.model_validate(value)
                for key, value in (await read_custom_calendar(session)).items()
            },
            alert=await read_alert(session),
        )

    response.headers["Cache-Control"] = "no-cache"
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


_VERSION_QUERY = union_all(
    *[
        select(
            literal(name).label("part"),
            literal(index).label("slot"),
            func.count().label("total"),
            func.max(model.updated_at).label("changed"),
        ).select_from(model)
        for name, models in _PARTS.items()
        for index, model in enumerate(models)
    ]
)


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
        buckets: dict[str, dict[int, str]] = {name: {} for name in _PARTS}
        for name, slot, count, changed in (await session.execute(_VERSION_QUERY)).all():
            buckets[name][slot] = f"{count}:{changed}"
        parts = {
            name: hashlib.sha256(
                "|".join(buckets[name][i] for i in range(len(models))).encode()
            ).hexdigest()[:12]
            for name, models in _PARTS.items()
        }
        return ContentVersion(parts=parts)

    response.headers["Cache-Control"] = "no-cache"
    return await db.read(read)
