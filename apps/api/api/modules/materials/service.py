"""Material compartilhado por matéria: provas, listas e resumos, anônimos.

O material é da matéria, não da turma: quem cursa com outro docente também vê, sabendo de qual
turma e docentes ele veio. Limites por aluno, por matéria e de espaço; só os últimos semestres
ficam guardados e os mais antigos são apagados sozinhos.
"""

import hashlib
import re
import unicodedata
import uuid
from functools import partial
from typing import Annotated, Literal

from anyio import CapacityLimiter, to_thread
from fastapi import Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from api import academic_calendar
from api.anonymous import owns, resource_key
from api.community_limits import read_limits
from api.db.context import set_context
from api.db.main import DatabaseDep, after_commit
from api.db.models import Classroom, Material, Subject
from api.db.search import contains_term
from api.modules.community.quotas import MAX_DAILY_UPLOAD_ATTEMPTS
from api.modules.materials.sanitize import EXTENSIONS, InvalidFile, sanitize, sniff
from api.schemas import SubjectReference
from api.storage import LocalStorage, material_storage

MaterialKind = Literal["prova", "lista", "resumo", "anotacao", "outro"]

MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_PER_SUBJECT = 50
MAX_SUBJECT_BYTES = 100 * 1024 * 1024
# O semestre atual e os cinco anteriores.
KEEP_SEMESTERS = 6
_SANITIZERS = CapacityLimiter(2)


class Limits(BaseModel):
    max_file_bytes: int = MAX_FILE_BYTES
    max_daily_upload_attempts: int = MAX_DAILY_UPLOAD_ATTEMPTS
    max_per_subject: int = MAX_PER_SUBJECT
    max_subject_bytes: int = MAX_SUBJECT_BYTES
    keep_semesters: int = KEEP_SEMESTERS


class Usage(BaseModel):
    files: int
    bytes: int
    mine: int


class MaterialItem(BaseModel):
    id: uuid.UUID
    title: str
    kind: MaterialKind
    semester: str
    classroom_number: str | None
    professors: list[str]
    filename: str
    mime: str
    size: int
    # Só mês e ano do envio.
    month: str
    mine: bool


class SubjectMaterials(BaseModel):
    subject: SubjectReference
    oldest_semester: str
    limits: Limits
    usage: Usage
    items: list[MaterialItem]


class SubjectWithMaterials(BaseModel):
    code: str
    name: str
    files: int


class MaterialUpload(BaseModel):
    title: str
    kind: MaterialKind
    semester: str
    classroom_number: str | None


def oldest_semester() -> str:
    current = academic_calendar.current_regular_semester()
    return academic_calendar.shift_regular_semester(current, 1 - KEEP_SEMESTERS)


def _scope(code: str) -> str:
    return f"material:{code}"


def safe_filename(name: str, mime: str) -> str:
    """Nome para o download: sem pasta, sem caracteres estranhos e com a extensão do tipo real."""
    stem = re.split(r"[\\/]", name)[-1].rsplit(".", 1)[0]
    stem = unicodedata.normalize("NFKD", stem).encode("ascii", "ignore").decode()
    stem = re.sub(r"[^A-Za-z0-9 _-]+", "", stem).strip()[:60] or "material"
    return f"{stem}{EXTENSIONS[mime]}"


def _item(material: Material, author: str) -> MaterialItem:
    return MaterialItem(
        id=material.id,
        title=material.title,
        kind=material.kind,
        semester=material.semester,
        classroom_number=material.classroom_number,
        professors=material.professors,
        filename=material.filename,
        mime=material.mime,
        size=material.size,
        month=material.created_at.strftime("%Y-%m"),
        mine=owns(material.uploader_key, author, _scope(material.subject_code)),
    )


async def _subject(session: AsyncSession, code: str) -> Subject:
    subject = await session.get(Subject, code)
    if subject is None:
        raise HTTPException(404, "Matéria não encontrada.")
    return subject


async def purge_expired(session: AsyncSession, storage: LocalStorage) -> int:
    """Apaga os materiais de semestres que já saíram da janela guardada."""
    expired = list(
        await session.scalars(
            select(Material).where(Material.semester < oldest_semester())
        )
    )
    for material in expired:
        after_commit(session, partial(storage.delete, material.storage_key))
        await session.delete(material)
    await session.flush()
    return len(expired)


class MaterialService:
    def __init__(self, db: DatabaseDep) -> None:
        self._db = db
        self._storage = material_storage()

    async def subjects(self, q: str | None) -> list[SubjectWithMaterials]:
        async def load(session: AsyncSession) -> list[SubjectWithMaterials]:
            query = (
                select(Subject.code, Subject.name, func.count(Material.id))
                .join(Material, Material.subject_code == Subject.code)
                .where(Material.semester >= oldest_semester())
                .group_by(Subject.code, Subject.name)
                .order_by(func.count(Material.id).desc(), Subject.name)
                .limit(100)
            )
            if q:
                query = query.where(
                    (Subject.code.contains(q.upper(), autoescape=True))
                    | contains_term(Subject.name, q)
                )
            rows = await session.execute(query)
            return [
                SubjectWithMaterials(code=code, name=name, files=files)
                for code, name, files in rows
            ]

        return await self._db.read(load)

    async def list(self, code: str, author: str) -> SubjectMaterials:
        async def load(session: AsyncSession) -> SubjectMaterials:
            subject = await _subject(session, code)
            oldest = oldest_semester()
            materials = list(
                await session.scalars(
                    select(Material)
                    .where(Material.subject_code == code, Material.semester >= oldest)
                    .order_by(Material.semester.desc(), Material.created_at.desc())
                )
            )
            items = [_item(material, author) for material in materials]
            return SubjectMaterials(
                subject=SubjectReference(code=subject.code, name=subject.name),
                oldest_semester=oldest,
                limits=await effective_limits(session),
                usage=Usage(
                    files=len(items),
                    bytes=sum(item.size for item in items),
                    mine=sum(item.mine for item in items),
                ),
                items=items,
            )

        return await self._db.read(load)

    async def upload(
        self,
        code: str,
        author: str,
        meta: MaterialUpload,
        filename: str,
        data: bytes,
    ) -> MaterialItem:
        oldest = oldest_semester()
        newest = academic_calendar.shift_regular_semester(
            academic_calendar.current_regular_semester(), 1
        )
        if not oldest <= meta.semester <= newest:
            raise HTTPException(
                422, f"O semestre precisa estar entre {oldest} e {newest}."
            )
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(413, "Arquivo maior que 20 MB.")
        mime = sniff(data, filename)
        if mime is None:
            raise HTTPException(
                415,
                "Envie PDF, imagem (PNG, JPEG ou WebP), documento Office (DOCX, PPTX ou XLSX) ou texto (.txt).",
            )
        try:
            clean = await to_thread.run_sync(sanitize, data, mime, limiter=_SANITIZERS)
        except InvalidFile as error:
            raise HTTPException(422, str(error)) from error
        if len(clean) > MAX_FILE_BYTES:
            raise HTTPException(413, "Arquivo maior que 20 MB.")
        digest = hashlib.sha256(clean).hexdigest()
        key = resource_key(author)
        storage_key = uuid.uuid4().hex
        set_context(oldest_semester=oldest_semester())

        async def write(session: AsyncSession) -> MaterialItem:
            await _subject(session, code)
            configured = await effective_limits(session)
            if max(len(data), len(clean)) > configured.max_file_bytes:
                raise HTTPException(
                    413,
                    f"O limite atual por arquivo é {configured.max_file_bytes // 1024**2} MB.",
                )
            # Um envio por vez na matéria: os limites não estouram com dois ao mesmo tempo.
            await session.execute(
                text("SELECT pg_advisory_xact_lock(hashtext(:scope))"),
                {"scope": _scope(code)},
            )
            await purge_expired(session, self._storage)
            files, size, duplicate = (
                await session.execute(
                    select(
                        func.count(Material.id),
                        func.coalesce(func.sum(Material.size), 0),
                        func.count(Material.id).filter(Material.sha256 == digest),
                    ).where(Material.subject_code == code)
                )
            ).one()
            if duplicate:
                raise HTTPException(409, "Esse arquivo já foi enviado nesta matéria.")
            if files >= configured.max_per_subject:
                raise HTTPException(
                    409,
                    f"A matéria já tem {configured.max_per_subject} arquivos, o limite.",
                )
            if size + len(clean) > configured.max_subject_bytes:
                raise HTTPException(
                    409, "A matéria não tem mais espaço dentro do limite atual."
                )
            professors: list[str] = []
            if meta.classroom_number:
                classroom = await session.scalar(
                    select(Classroom).where(
                        Classroom.subject_code == code,
                        Classroom.semester == meta.semester,
                        Classroom.number == meta.classroom_number,
                    )
                )
                if classroom is not None:
                    professors = [professor.name for professor in classroom.professors]
            material = Material(
                subject_code=code,
                semester=meta.semester,
                classroom_number=meta.classroom_number,
                professors=professors,
                title=meta.title,
                kind=meta.kind,
                filename=safe_filename(filename, mime),
                mime=mime,
                size=len(clean),
                sha256=digest,
                storage_key=storage_key,
                uploader_key=key,
            )
            session.add(material)
            await session.flush()
            await session.refresh(material)
            return _item(material, author)

        await self._storage.save(storage_key, clean)
        try:
            return await self._db.write(write)
        except HTTPException, IntegrityError:
            # Falhas confirmadamente revertidas permitem limpar; queda de conexão tem resultado incerto.
            await self._storage.delete(storage_key)
            raise

    async def download(
        self, code: str, material_id: uuid.UUID
    ) -> tuple[Material, bytes]:
        async def load(session: AsyncSession) -> Material | None:
            material = await session.get(Material, material_id)
            if (
                material is None
                or material.subject_code != code
                or material.semester < oldest_semester()
            ):
                return None
            return material

        material = await self._db.read(load)
        data = await self._storage.read(material.storage_key) if material else None
        if material is None or data is None:
            raise HTTPException(404, "Material não encontrado.")
        return material, data

    async def delete(self, code: str, material_id: uuid.UUID, author: str) -> None:
        async def write(session: AsyncSession) -> str:
            material = await session.get(Material, material_id)
            if (
                material is None
                or material.subject_code != code
                or not owns(material.uploader_key, author, _scope(code))
            ):
                raise HTTPException(404, "Material não encontrado.")
            await session.delete(material)
            return material.storage_key

        storage_key = await self._db.write(write)
        await self._storage.delete(storage_key)


async def delete_material(session: AsyncSession, material_id: uuid.UUID) -> bool:
    """Apaga pela moderação, com o arquivo."""
    material = await session.get(Material, material_id)
    if material is None:
        return False
    after_commit(session, partial(material_storage().delete, material.storage_key))
    await session.execute(delete(Material).where(Material.id == material_id))
    return True


MaterialServiceDep = Annotated[MaterialService, Depends()]


async def effective_limits(session: AsyncSession) -> Limits:
    configured = await read_limits(session)
    return Limits(
        max_file_bytes=min(MAX_FILE_BYTES, configured.materials_file_mb * 1024**2),
        max_daily_upload_attempts=min(
            MAX_DAILY_UPLOAD_ATTEMPTS, configured.upload_attempts_per_day
        ),
        max_per_subject=min(MAX_PER_SUBJECT, configured.materials_per_subject),
        max_subject_bytes=min(
            MAX_SUBJECT_BYTES, configured.materials_subject_mb * 1024**2
        ),
    )
