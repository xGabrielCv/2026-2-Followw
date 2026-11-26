"""Configuração administrativa do calendário estendido e do alerta do semestre."""

import json
import re
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from unb_browser import SemesterCalendar, load_academic_calendar

from api import academic_calendar
from api.db.main import DatabaseDep
from api.db.models import SystemText
from api.modules.admin import auth
from api.modules.admin.service import log
from api.semester_alert import (
    ALERT_PRESETS,
    SemesterAlertConfig,
    read_alert,
    save_alert,
)
from api.sharing_policy import (
    StatisticsSharingPolicy,
    read_sharing_policy,
    save_sharing_policy,
)

router = APIRouter(dependencies=[auth.require_permission("configure")])
_SEMESTER_RE = re.compile(r"^\d{4}\.\d$")


class CalendarUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    semesters: dict[str, SemesterCalendar]


@router.get("/calendar")
async def get_calendar_admin(db: DatabaseDep) -> dict:
    async def read(session: AsyncSession) -> dict:
        cal = await academic_calendar.read_calendar(session)
        current = academic_calendar.current_regular_semester(calendar=cal)
        custom = await academic_calendar.read_custom_calendar(
            session, include_collected=False
        )
        static = load_academic_calendar().list_semesters()
        static_latest = max((s.semester for s in static), default=None)
        return {
            "current_semester": current,
            "next_semester": academic_calendar.shift_regular_semester(current, 1),
            "enrollment_active": academic_calendar.is_enrollment_period(
                current, calendar=cal
            ),
            "static_latest": static_latest,
            "custom": custom,
            "collected": sorted(academic_calendar.collected_calendar()),
        }

    return await db.read(read)


@router.put("/calendar")
async def save_calendar_admin(
    body: CalendarUpdate, request: Request, db: DatabaseDep
) -> dict:
    for key, value in body.semesters.items():
        if not _SEMESTER_RE.fullmatch(key) or value.semester != key:
            raise HTTPException(
                422, f"Chave '{key}' precisa coincidir com o semestre (AAAA.P)."
            )
    payload = json.dumps(
        {
            key: value.model_dump(mode="json")
            for key, value in sorted(body.semesters.items())
        },
        ensure_ascii=False,
    )

    async def write(session: AsyncSession) -> dict:
        row = await session.get(SystemText, academic_calendar.CALENDAR_KEY)
        if row is None:
            session.add(SystemText(key=academic_calendar.CALENDAR_KEY, value=payload))
        else:
            row.value = payload
        await log(
            session,
            "academic.calendar",
            detail=f"{len(body.semesters)} semestre(s) customizado(s)",
            actor=request.state.admin,
        )
        return {"saved": sorted(body.semesters)}

    return await db.write(write)


@router.get("/alert")
async def get_alert_admin(db: DatabaseDep) -> dict:
    async def read(session: AsyncSession) -> dict:
        cal = await academic_calendar.read_calendar(session)
        config = await read_alert(session)
        return {
            "config": config,
            "presets": {
                key: {"title": title, "message": message}
                for key, (title, message) in ALERT_PRESETS.items()
            },
            "current_semester": academic_calendar.current_regular_semester(
                calendar=cal
            ),
            "progress_percent": academic_calendar.semester_progress_percent(
                calendar=cal
            ),
        }

    return await db.read(read)


@router.put("/alert")
async def update_alert_admin(
    body: SemesterAlertConfig, request: Request, db: DatabaseDep
) -> SemesterAlertConfig:
    async def write(session: AsyncSession) -> SemesterAlertConfig:
        await session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext('config:semester-alert'))")
        )
        current = await read_alert(session)
        saved = await save_alert(
            session,
            body.model_copy(
                update={
                    "trigger_id": current.trigger_id,
                    "triggered_at": current.triggered_at,
                }
            ),
        )
        await log(
            session,
            "community.alert",
            detail=f"enabled={saved.enabled} always_on={saved.always_on} mid={saved.mid_semester_enabled}:{saved.mid_semester_every_n}x",
            actor=request.state.admin,
        )
        return saved

    return await db.write(write)


class TriggerInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str | None = Field(default=None, min_length=3, max_length=120)
    message: str | None = Field(default=None, min_length=3, max_length=600)


@router.post("/alert/trigger")
async def trigger_alert_now(
    request: Request, db: DatabaseDep, body: TriggerInput | None = None
) -> SemesterAlertConfig:
    async def write(session: AsyncSession) -> SemesterAlertConfig:
        await session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext('config:semester-alert'))")
        )
        current = await read_alert(session)
        updates: dict = {
            "enabled": True,
            "trigger_id": uuid.uuid4().hex[:12],
            "triggered_at": datetime.now(UTC),
        }
        if body and body.title:
            updates["title"] = body.title.strip()
        if body and body.message:
            updates["message"] = body.message.strip()
        try:
            updated = current.model_copy(update=updates)
            SemesterAlertConfig.model_validate(updated.model_dump())
        except ValidationError as error:
            raise HTTPException(422, "Texto do alerta inválido.") from error
        await save_alert(session, updated)
        await log(
            session,
            "community.alert.trigger",
            detail=updated.trigger_id,
            actor=request.state.admin,
        )
        return updated

    return await db.write(write)


class SharingPolicyInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    semester_percent: int = Field(ge=50, le=100)
    interval_days: int = Field(ge=30, le=365)


@router.get("/sharing-policy")
async def get_sharing_policy_admin(db: DatabaseDep) -> dict:
    async def read(session: AsyncSession) -> dict:
        cal = await academic_calendar.read_calendar(session)
        return {
            "config": await read_sharing_policy(session),
            "current_semester": academic_calendar.current_regular_semester(
                calendar=cal
            ),
            "progress_percent": academic_calendar.semester_progress_percent(
                calendar=cal
            ),
        }

    return await db.read(read)


@router.put("/sharing-policy")
async def update_sharing_policy_admin(
    body: SharingPolicyInput, request: Request, db: DatabaseDep
) -> StatisticsSharingPolicy:
    async def write(session: AsyncSession) -> StatisticsSharingPolicy:
        await session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext('config:sharing-policy'))")
        )
        current = await read_sharing_policy(session)
        saved = await save_sharing_policy(
            session,
            current.model_copy(
                update={
                    "semester_percent": body.semester_percent,
                    "interval_days": body.interval_days,
                }
            ),
        )
        await log(
            session,
            "community.sharing_policy",
            detail=f"semester_percent={saved.semester_percent} interval_days={saved.interval_days}",
            actor=request.state.admin,
        )
        return saved

    return await db.write(write)


@router.post("/sharing-policy/trigger")
async def trigger_sharing_policy_now(
    request: Request, db: DatabaseDep
) -> StatisticsSharingPolicy:
    async def write(session: AsyncSession) -> StatisticsSharingPolicy:
        await session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext('config:sharing-policy'))")
        )
        current = await read_sharing_policy(session)
        updated = current.model_copy(
            update={
                "trigger_id": uuid.uuid4().hex[:12],
                "triggered_at": datetime.now(UTC),
            }
        )
        await save_sharing_policy(session, updated)
        await log(
            session,
            "community.sharing_policy.trigger",
            detail=updated.trigger_id,
            actor=request.state.admin,
        )
        return updated

    return await db.write(write)
