"""Painel do administrador: uso, recursos da instância, moderação, dados e controle do sistema.

Fica fora do app e do OpenAPI. Nada aqui identifica aluno: o uso é contado por chaves anônimas
por período, e o conteúdo da comunidade já não guarda autor.
"""

import os
import platform
import shutil
import sys
import time
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any, Literal

import psutil
from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from api import academic_calendar
from api.core.config import settings
from api.crypto import matches
from api.db.main import DatabaseDep
from api.db.models import (
    ActiveUser,
    AdminLog,
    Classroom,
    ForumPost,
    Material,
    Professor,
    ProfessorReview,
    Report,
    SharedStatistics,
    Subject,
    SystemFlag,
    SystemText,
    Tutorial,
)
from api.flags import FLAGS, MENU, TEXTS, flags, menu, texts
from api.modules.admin.models import AdminAccount
from api.modules.admin.permissions import Principal
from api.modules.auth.account import periods
from api.modules.materials.service import purge_expired
from api.modules.reports.service import TARGETS, delete_target
from api.storage import material_storage

_STARTED = time.time()
_PROCESS = psutil.Process(os.getpid())
_PROCESS.cpu_percent(interval=None)
psutil.cpu_percent(interval=None)
ContentType = Literal[
    "review", "group", "material", "post", "reply", "tutorial", "report"
]
_MODELS: dict[str, Any] = {**TARGETS, "report": Report}
_LABELS = {
    "review": "avaliações",
    "group": "grupos",
    "material": "materiais",
    "post": "publicações",
    "reply": "respostas",
    "tutorial": "guias",
    "report": "denúncias",
}
# Uso anônimo e denúncias resolvidas não precisam ficar para sempre.
_ACTIVITY_DAYS = 400
_RESOLVED_REPORTS_DAYS = 180
_SEARCH_WINDOW = 5000


class Overview(BaseModel):
    environment: str
    demo_data: bool
    python: str
    platform: str
    hostname_hint: str
    uptime_seconds: int
    process: dict[str, float]
    system: dict[str, float]
    database_bytes: int
    database_connections: int
    tables: list[dict[str, Any]]
    materials_bytes: int
    materials_files: int
    counts: dict[str, int]
    pending: dict[str, int]
    users: dict[str, int]
    flags: dict[str, bool]
    menu: list[dict[str, Any]]
    texts: list[dict[str, Any]]


class Series(BaseModel):
    days: list[str]
    series: dict[str, list[int]]
    weeks: list[dict[str, Any]]
    months: list[dict[str, Any]]
    totals: dict[str, int]


class Breakdown(BaseModel):
    ratings: list[int]
    attendance: dict[str, int]
    materials_by_kind: dict[str, int]
    posts_by_campus: dict[str, int]
    posts_by_kind: dict[str, int]
    top_subjects: list[dict[str, Any]]
    tutorials_by_category: dict[str, int]
    reports_by_reason: dict[str, int]


class Row(BaseModel):
    id: uuid.UUID
    type: str
    title: str
    detail: str | None
    tags: list[str]
    created_at: datetime


class Page(BaseModel):
    items: list[Row]
    total: int
    page: int
    page_size: int


class ReportView(BaseModel):
    id: uuid.UUID
    target_type: str
    target_id: uuid.UUID
    reason: str
    message: str | None
    status: str
    created_at: datetime
    preview: str | None


class TutorialView(BaseModel):
    id: uuid.UUID
    title: str
    summary: str
    body: str
    category: str
    status: str
    created_at: datetime


class TutorialEdit(BaseModel):
    title: str
    summary: str
    body: str
    category: str


async def _count(session: AsyncSession, model: Any, *where: Any) -> int:
    return (
        await session.scalar(select(func.count()).select_from(model).where(*where)) or 0
    )


def _row(kind: str, item: Any) -> Row:
    """Uma linha legível do conteúdo, já decifrado."""
    match kind:
        case "review":
            title = f"Nota {item.rating}" + (
                f" · {item.subject_code}" if item.subject_code else ""
            )
            return Row(
                id=item.id,
                type=kind,
                title=title,
                detail=item.comment,
                tags=[t for t in (item.attendance,) if t],
                created_at=item.created_at,
            )
        case "group":
            return Row(
                id=item.id,
                type=kind,
                title=f"{item.platform} · posição {item.position + 1}",
                detail=item.url + (" (com senha)" if item.password else ""),
                tags=[],
                created_at=item.created_at,
            )
        case "material":
            return Row(
                id=item.id,
                type=kind,
                title=f"{item.subject_code} · {item.title}",
                detail=f"{item.filename} · {item.size // 1024} KB · {item.mime}",
                tags=[item.kind, item.semester]
                + ([f"turma {item.classroom_number}"] if item.classroom_number else []),
                created_at=item.created_at,
            )
        case "post":
            return Row(
                id=item.id,
                type=kind,
                title=item.title,
                detail=item.body,
                tags=[t for t in (item.kind, item.campus, item.subject_code) if t]
                + [f"{item.reply_count} respostas"],
                created_at=item.created_at,
            )
        case "reply":
            return Row(
                id=item.id,
                type=kind,
                title=f"Resposta em {item.post_id}",
                detail=item.body,
                tags=[],
                created_at=item.created_at,
            )
        case "tutorial":
            return Row(
                id=item.id,
                type=kind,
                title=item.title,
                detail=item.summary,
                tags=[item.category, item.status],
                created_at=item.created_at,
            )
        case "report":
            return Row(
                id=item.id,
                type=kind,
                title=f"{item.reason} · {item.target_type}",
                detail=item.message,
                tags=[item.status],
                created_at=item.created_at,
            )
    raise HTTPException(404, "Tipo desconhecido.")


def _text(row: Row) -> list[str | None]:
    return [row.title, row.detail, *row.tags]


async def _preview(
    session: AsyncSession, target_type: str, target_id: uuid.UUID
) -> str | None:
    item = await session.get(_MODELS[target_type], target_id)
    if item is None:
        return None
    row = _row(target_type, item)
    return f"{row.title}: {row.detail or ''}"[:500]


async def log(
    session: AsyncSession,
    action: str,
    target_type: str | None = None,
    target_id: object = None,
    detail: str | None = None,
    *,
    actor: Principal | AdminAccount | None = None,
) -> None:
    session.add(
        AdminLog(
            action=action,
            target_type=target_type,
            target_id=str(target_id) if target_id is not None else None,
            detail=detail,
            actor_id=actor.id if actor else None,
            actor_role=actor.role if actor else None,
        )
    )


def _day_range(days: int) -> list[date]:
    today = academic_calendar.today()
    return [today - timedelta(days=offset) for offset in range(days - 1, -1, -1)]


class AdminService:
    def __init__(self, db: DatabaseDep, request: Request) -> None:
        self._db = db
        self._actor = getattr(request.state, "admin", None)

    async def _log(self, session: AsyncSession, *args, **kwargs) -> None:
        await log(session, *args, **kwargs, actor=self._actor)

    async def overview(self) -> Overview:
        process = _PROCESS
        with process.oneshot():
            memory = process.memory_info().rss
            cpu = process.cpu_percent(interval=None)
            threads = process.num_threads()
        disk = shutil.disk_usage(
            settings.materials_dir if os.path.exists(settings.materials_dir) else "."
        )
        virtual = psutil.virtual_memory()
        load = os.getloadavg() if hasattr(os, "getloadavg") else (0.0, 0.0, 0.0)
        day, week, month = periods(academic_calendar.today())

        async def read(session: AsyncSession) -> tuple:
            size = await session.scalar(
                text("SELECT pg_database_size(current_database())")
            )
            connections = await session.scalar(
                text(
                    "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()"
                )
            )
            tables = [
                {"table": name, "rows": rows, "bytes": total}
                for name, rows, total in (
                    await session.execute(
                        text(
                            "SELECT relname, n_live_tup, pg_total_relation_size(relid) "
                            "FROM pg_stat_user_tables ORDER BY 3 DESC LIMIT 12"
                        )
                    )
                ).all()
            ]
            counts = {_LABELS[k]: await _count(session, m) for k, m in _MODELS.items()}
            counts |= {
                "turmas com índices liberados": await session.scalar(
                    select(func.count(func.distinct(SharedStatistics.classroom_id)))
                )
                or 0,
                "turmas": await _count(session, Classroom),
                "turmas abertas por alunos": await _count(
                    session, Classroom, Classroom.front_end_id.is_not(None)
                ),
                "matérias": await _count(session, Subject),
                "docentes": await _count(session, Professor),
            }
            pending = {
                "denúncias": await _count(session, Report, Report.status == "pending"),
                "guias": await _count(session, Tutorial, Tutorial.status == "pending"),
            }
            users = {
                "hoje": await _count(session, ActiveUser, ActiveUser.period == day),
                "esta semana": await _count(
                    session, ActiveUser, ActiveUser.period == week
                ),
                "este mês": await _count(
                    session, ActiveUser, ActiveUser.period == month
                ),
            }
            return (
                size or 0,
                connections or 0,
                tables,
                counts,
                pending,
                users,
                await flags(session),
                (await menu(session), await texts(session)),
            )

        (
            size,
            connections,
            tables,
            counts,
            pending,
            users,
            current,
            (visible, links),
        ) = await self._db.read(read)
        storage = material_storage()
        return Overview(
            environment=settings.environment,
            demo_data=settings.demo_data,
            python=sys.version.split()[0],
            platform=platform.platform(),
            hostname_hint=platform.node()[:3] + "…" if platform.node() else "",
            uptime_seconds=int(time.time() - _STARTED),
            process={"memory_bytes": memory, "cpu_percent": cpu, "threads": threads},
            system={
                "cpu_percent": psutil.cpu_percent(interval=None),
                "cpus": psutil.cpu_count() or 0,
                "load_1m": load[0],
                "load_5m": load[1],
                "memory_percent": virtual.percent,
                "memory_used_bytes": virtual.used,
                "memory_total_bytes": virtual.total,
                "disk_free_bytes": disk.free,
                "disk_total_bytes": disk.total,
                "boot_seconds": int(time.time() - psutil.boot_time()),
            },
            database_bytes=size,
            database_connections=connections,
            tables=tables,
            materials_bytes=await storage.usage(),
            materials_files=counts[_LABELS["material"]],
            counts=counts,
            pending=pending,
            users=users,
            flags=current,
            menu=[
                {"key": key, "label": label, "visible": visible[key]}
                for key, (label, _) in MENU.items()
            ],
            texts=[
                {"key": key, "label": label, "value": links[key]}
                for key, (label, _) in TEXTS.items()
            ],
        )

    async def series(self, days: int) -> Series:
        """Uso e conteúdo novo por dia; alunos únicos por semana e por mês."""
        range_ = _day_range(days)
        start = datetime.combine(range_[0], datetime.min.time(), UTC)

        async def read(session: AsyncSession) -> Series:
            active = dict(
                (
                    await session.execute(
                        select(ActiveUser.period, func.count())
                        .where(
                            ActiveUser.period.in_(
                                [f"d:{d.isoformat()}" for d in range_]
                            )
                        )
                        .group_by(ActiveUser.period)
                    )
                ).all()
            )
            series = {
                "alunos ativos": [active.get(f"d:{d.isoformat()}", 0) for d in range_]
            }
            totals = {}
            for kind, model in _MODELS.items():
                created = func.date(
                    func.timezone("America/Sao_Paulo", model.created_at)
                )
                rows = dict(
                    (
                        await session.execute(
                            select(created, func.count())
                            .where(model.created_at >= start)
                            .group_by(created)
                        )
                    ).all()
                )
                series[_LABELS[kind]] = [rows.get(d, 0) for d in range_]
                totals[_LABELS[kind]] = sum(series[_LABELS[kind]])
            weekly = (
                await session.execute(
                    select(ActiveUser.period, func.count())
                    .where(ActiveUser.period.like("w:%"))
                    .group_by(ActiveUser.period)
                    .order_by(ActiveUser.period.desc())
                    .limit(26)
                )
            ).all()
            monthly = (
                await session.execute(
                    select(ActiveUser.period, func.count())
                    .where(ActiveUser.period.like("m:%"))
                    .group_by(ActiveUser.period)
                    .order_by(ActiveUser.period.desc())
                    .limit(24)
                )
            ).all()
            totals["alunos ativos (soma dos dias)"] = sum(series["alunos ativos"])
            return Series(
                days=[d.isoformat() for d in range_],
                series=series,
                weeks=[{"period": p[2:], "users": n} for p, n in reversed(weekly)],
                months=[{"period": p[2:], "users": n} for p, n in reversed(monthly)],
                totals=totals,
            )

        return await self._db.read(read)

    async def breakdown(self) -> Breakdown:
        async def grouped(session: AsyncSession, column: Any) -> dict[str, int]:
            rows = (
                await session.execute(select(column, func.count()).group_by(column))
            ).all()
            return {
                str(key) if key is not None else "sem": count for key, count in rows
            }

        async def read(session: AsyncSession) -> Breakdown:
            buckets = [0] * 10
            for rating, count in (
                await session.execute(
                    select(ProfessorReview.rating, func.count()).group_by(
                        ProfessorReview.rating
                    )
                )
            ).all():
                buckets[min(rating // 10, 9)] += count
            materials = select(
                Material.subject_code.label("code"), func.count().label("n")
            ).group_by(Material.subject_code)
            posts = (
                select(ForumPost.subject_code.label("code"), func.count().label("n"))
                .where(ForumPost.subject_code.is_not(None))
                .group_by(ForumPost.subject_code)
            )
            union = materials.union_all(posts).subquery()
            top = (
                await session.execute(
                    select(union.c.code, func.sum(union.c.n))
                    .group_by(union.c.code)
                    .order_by(func.sum(union.c.n).desc())
                    .limit(10)
                )
            ).all()
            return Breakdown(
                ratings=buckets,
                attendance=await grouped(session, ProfessorReview.attendance),
                materials_by_kind=await grouped(session, Material.kind),
                posts_by_campus=await grouped(session, ForumPost.campus),
                posts_by_kind=await grouped(session, ForumPost.kind),
                top_subjects=[{"code": code, "items": int(n)} for code, n in top],
                tutorials_by_category=await grouped(session, Tutorial.category),
                reports_by_reason=await grouped(session, Report.reason),
            )

        return await self._db.read(read)

    async def content(
        self,
        kind: ContentType,
        *,
        q: str | None,
        status: str | None,
        subject: str | None,
        days: int | None,
        page: int,
        page_size: int,
    ) -> Page:
        model = _MODELS[kind]

        async def read(session: AsyncSession) -> Page:
            query = select(model).order_by(model.created_at.desc(), model.id)
            if status and hasattr(model, "status"):
                query = query.where(model.status == status)
            if subject and hasattr(model, "subject_code"):
                query = query.where(model.subject_code == subject.upper())
            if days:
                query = query.where(
                    model.created_at >= datetime.now(UTC) - timedelta(days=days)
                )
            if q:
                # O conteúdo é cifrado no banco: a busca é feita já decifrado.
                rows = [
                    row
                    for item in await session.scalars(query.limit(_SEARCH_WINDOW))
                    if matches(q, *_text(row := _row(kind, item)))
                ]
                start = (page - 1) * page_size
                return Page(
                    items=rows[start : start + page_size],
                    total=len(rows),
                    page=page,
                    page_size=page_size,
                )
            total = await session.scalar(
                select(func.count()).select_from(query.order_by(None).subquery())
            )
            items = await session.scalars(
                query.offset((page - 1) * page_size).limit(page_size)
            )
            return Page(
                items=[_row(kind, item) for item in items],
                total=total or 0,
                page=page,
                page_size=page_size,
            )

        return await self._db.read(read)

    async def detail(self, kind: ContentType, content_id: uuid.UUID) -> dict[str, Any]:
        """Todos os campos do item, decifrados, menos as chaves anônimas de autoria."""
        model = _MODELS[kind]
        hidden = {"author_key", "uploader_key", "token_hash", "storage_key", "sha256"}

        async def read(session: AsyncSession) -> dict[str, Any]:
            item = await session.get(model, content_id)
            if item is None:
                raise HTTPException(404, "Conteúdo não encontrado.")
            return {
                column.key: getattr(item, column.key)
                for column in model.__mapper__.column_attrs
                if column.key not in hidden
            }

        return await self._db.read(read)

    async def delete(
        self, kind: ContentType, content_id: uuid.UUID, reason: str | None
    ) -> None:
        async def write(session: AsyncSession) -> None:
            if kind == "report":
                result = await session.execute(
                    delete(Report).where(Report.id == content_id)
                )
                found = bool(result.rowcount)
            else:
                found = await delete_target(session, kind, content_id)
            if not found:
                raise HTTPException(404, "Conteúdo não encontrado.")
            await self._log(session, "delete", kind, content_id, reason)

        await self._db.write(write)

    async def material_file(self, material_id: uuid.UUID) -> tuple[Material, bytes]:
        material = await self._db.read(
            lambda session: session.get(Material, material_id)
        )
        data = await material_storage().read(material.storage_key) if material else None
        if material is None or data is None:
            raise HTTPException(404, "Arquivo não encontrado.")
        return material, data

    async def edit_tutorial(self, tutorial_id: uuid.UUID, body: TutorialEdit) -> None:
        async def write(session: AsyncSession) -> None:
            tutorial = await session.get(Tutorial, tutorial_id)
            if tutorial is None:
                raise HTTPException(404, "Guia não encontrado.")
            tutorial.title = body.title
            tutorial.summary = body.summary
            tutorial.body = body.body
            tutorial.category = body.category
            await self._log(session, "tutorial.edit", "tutorial", tutorial_id)

        await self._db.write(write)

    async def set_flag(self, key: str, enabled: bool) -> dict[str, bool]:
        if key not in FLAGS:
            raise HTTPException(404, "Opção desconhecida.")

        async def write(session: AsyncSession) -> dict[str, bool]:
            flag = await session.get(SystemFlag, key)
            if flag is None:
                session.add(SystemFlag(key=key, enabled=enabled))
            else:
                flag.enabled = enabled
            await self._log(session, "flag.on" if enabled else "flag.off", "flag", key)
            await session.flush()
            return await flags(session)

        return await self._db.write(write)

    async def set_menu(self, key: str, visible: bool) -> dict[str, bool]:
        if key not in MENU:
            raise HTTPException(404, "Cartão desconhecido.")

        async def write(session: AsyncSession) -> dict[str, bool]:
            flag = await session.get(SystemFlag, f"menu.{key}")
            if flag is None:
                session.add(SystemFlag(key=f"menu.{key}", enabled=visible))
            else:
                flag.enabled = visible
            await self._log(
                session, "menu.show" if visible else "menu.hide", "menu", key
            )
            await session.flush()
            return await menu(session)

        return await self._db.write(write)

    async def set_text(self, key: str, value: str) -> dict[str, str]:
        if key not in TEXTS:
            raise HTTPException(404, "Texto desconhecido.")

        async def write(session: AsyncSession) -> dict[str, str]:
            text_row = await session.get(SystemText, key)
            if text_row is None:
                session.add(SystemText(key=key, value=value))
            else:
                text_row.value = value
            await self._log(session, "text.set", "text", key, value or "(vazio)")
            await session.flush()
            return await texts(session)

        return await self._db.write(write)

    async def maintenance(self) -> dict[str, int]:
        """Apaga o que já venceu: materiais fora da janela, uso antigo e denúncias resolvidas."""

        async def write(session: AsyncSession) -> dict[str, int]:
            materials = await purge_expired(session, material_storage())
            oldest = academic_calendar.today() - timedelta(days=_ACTIVITY_DAYS)
            activity = await session.execute(
                delete(ActiveUser).where(
                    ActiveUser.period < f"d:{oldest.isoformat()}",
                    ActiveUser.period.like("d:%"),
                )
            )
            reports = await session.execute(
                delete(Report).where(
                    Report.status != "pending",
                    Report.resolved_at
                    < datetime.now(UTC) - timedelta(days=_RESOLVED_REPORTS_DAYS),
                )
            )
            result = {
                "materiais vencidos": materials,
                "registros de uso antigos": activity.rowcount or 0,
                "denúncias resolvidas antigas": reports.rowcount or 0,
            }
            await self._log(session, "maintenance", detail=str(result))
            return result

        return await self._db.write(write)

    async def record(self, action: str) -> None:
        await self._db.write(lambda session: self._log(session, action))


AdminServiceDep = Annotated[AdminService, Depends()]
