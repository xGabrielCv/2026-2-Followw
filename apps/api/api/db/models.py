import datetime as dt
import uuid
from datetime import datetime

from sqlalchemy import (
    ColumnElement,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    Text,
    UniqueConstraint,
    func,
    literal_column,
)
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import Mapped, mapped_column, relationship

from api.crypto import Encrypted
from api.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from api.modules.admin.models import AdminAccount, AdminSession  # noqa: F401 — registra tabelas administrativas
from api.modules.community.models import UploadBudget, UsedCommunityPermission  # noqa: F401 — registra controles efêmeros
from api.modules.logs.models import AppEvent  # noqa: F401 — registra os eventos técnicos
from api.modules.support.models import Ticket, TicketMessage  # noqa: F401 — registra os chamados
from api.modules.sync.models import SyncRun, SyncState  # noqa: F401 — registra a sincronização agendada

type Requirements = list[list[str]]


def _enum(enum: type, name: str) -> SAEnum:
    return SAEnum(enum, name=name, values_callable=lambda e: [m.value for m in e])


class Unit(Base, TimestampMixin):
    """Unidade acadêmica: o `id` é o do SIGAA e o `code` a sigla (ex.: FCTE)."""

    __tablename__ = "units"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=False)
    code: Mapped[str | None] = mapped_column(unique=True)
    name: Mapped[str] = mapped_column()


class Course(Base, TimestampMixin):
    """Curso de uma unidade; `sigaa_id` é nulo nos criados pelo sync, fora da lista do SIGAA."""

    __tablename__ = "courses"

    id: Mapped[int] = mapped_column(primary_key=True)
    sigaa_id: Mapped[int | None] = mapped_column(unique=True)
    name: Mapped[str] = mapped_column()
    shift: Mapped[str | None] = mapped_column()
    unit_id: Mapped[int] = mapped_column(ForeignKey("units.id"))

    unit: Mapped[Unit] = relationship(lazy="joined")


# Um só curso criado pelo sync por nome e unidade, mesmo com dois syncs ao mesmo tempo.
COURSE_WITHOUT_SIGAA_ID = Course.sigaa_id.is_(None)
Index(
    "uq_course_without_sigaa_id",
    Course.unit_id,
    Course.name,
    unique=True,
    postgresql_where=COURSE_WITHOUT_SIGAA_ID,
)


class Curriculum(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "curricula"
    __table_args__ = (
        UniqueConstraint("course_id", "sigaa_id", name="uq_curriculum_course_sigaa"),
        Index("ix_curriculum_course_valid_from", "course_id", "valid_from"),
    )

    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id"))
    sigaa_id: Mapped[int] = mapped_column()
    code: Mapped[str] = mapped_column()
    valid_from: Mapped[str] = mapped_column()
    created_year: Mapped[int] = mapped_column(SmallInteger)
    active: Mapped[bool] = mapped_column()
    shift: Mapped[str | None] = mapped_column()
    matrix: Mapped[str] = mapped_column()
    # Horas e semestres lidos da estrutura curricular.
    total_workload: Mapped[int | None] = mapped_column(SmallInteger)
    required_workload: Mapped[int | None] = mapped_column(SmallInteger)
    optional_min_workload: Mapped[int | None] = mapped_column(SmallInteger)
    complementary_min_workload: Mapped[int | None] = mapped_column(SmallInteger)
    elective_max_workload: Mapped[int | None] = mapped_column(SmallInteger)
    period_max_workload: Mapped[int | None] = mapped_column(SmallInteger)
    period_min_workload: Mapped[int | None] = mapped_column(SmallInteger)
    min_semesters: Mapped[int | None] = mapped_column(SmallInteger)
    avg_semesters: Mapped[int | None] = mapped_column(SmallInteger)
    max_semesters: Mapped[int | None] = mapped_column(SmallInteger)

    course: Mapped[Course] = relationship()


class CurriculumComponent(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "curriculum_components"
    __table_args__ = (
        UniqueConstraint(
            "curriculum_id",
            "subject_code",
            "kind",
            "period",
            name="uq_curriculum_component",
        ),
        Index("ix_curriculum_component_period", "curriculum_id", "period"),
    )

    curriculum_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("curricula.id"))
    subject_code: Mapped[str] = mapped_column()
    period: Mapped[int | None] = mapped_column(SmallInteger)
    kind: Mapped[str] = mapped_column()


class Professor(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Docente do catálogo (pelo `siape`) ou, sem ele, visto só numa turma."""

    __tablename__ = "professors"

    siape: Mapped[int | None] = mapped_column(unique=True)
    # `idPessoa` do SIGAA: único identificador dos docentes na lista de participantes.
    person_id: Mapped[int | None] = mapped_column(unique=True)
    name: Mapped[str] = mapped_column()
    unit_id: Mapped[int | None] = mapped_column(ForeignKey("units.id"))
    photo: Mapped[str | None] = mapped_column()
    description: Mapped[str | None] = mapped_column(Text)
    education: Mapped[list[dict[str, object]] | None] = mapped_column(
        JSONB(none_as_null=True)
    )
    interests: Mapped[str | None] = mapped_column(Text)
    lattes: Mapped[str | None] = mapped_column()
    email: Mapped[str | None] = mapped_column()
    disciplines: Mapped[list[dict[str, object]]] = mapped_column(JSONB, default=list)

    unit: Mapped[Unit | None] = relationship(lazy="joined")


class Subject(Base, TimestampMixin):
    __tablename__ = "subjects"

    code: Mapped[str] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column()
    hours: Mapped[int | None] = mapped_column(SmallInteger)
    unit_id: Mapped[int | None] = mapped_column(ForeignKey("units.id"))
    # Expressões em OU de Es: `[["A", "B"], ["C"]]` é `(A E B) OU C`.
    prerequisites: Mapped[Requirements | None] = mapped_column(JSONB)
    corequisites: Mapped[Requirements | None] = mapped_column(JSONB)
    equivalences: Mapped[Requirements | None] = mapped_column(JSONB)

    unit: Mapped[Unit | None] = relationship(lazy="joined")
    classrooms: Mapped[list[Classroom]] = relationship(back_populates="subject")

    @hybrid_property
    def equivalent_codes(self) -> list[str]:
        """Os códigos citados nas equivalências: `[["A", "B"], ["C"]]` -> `A, B, C`."""
        return [code for term in self.equivalences or [] for code in term]

    @equivalent_codes.inplace.expression
    @classmethod
    def _equivalent_codes_expression(cls) -> ColumnElement[list[str]]:
        return func.jsonb_path_query_array(
            cls.equivalences, literal_column("'$[*][*]'"), type_=JSONB
        )


class Classroom(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "classrooms"
    __table_args__ = (
        UniqueConstraint(
            "subject_code", "number", "semester", name="uq_classroom_subject_number"
        ),
    )

    sigaa_id: Mapped[int | None] = mapped_column()
    number: Mapped[str] = mapped_column()
    semester: Mapped[str] = mapped_column()
    schedule: Mapped[str | None] = mapped_column()
    room: Mapped[str | None] = mapped_column()
    # Vagas e ocupação vêm da busca pública, pelo seed.
    vacancies: Mapped[int | None] = mapped_column(SmallInteger)
    occupied: Mapped[int | None] = mapped_column(SmallInteger)
    enrollment_requests: Mapped[int | None] = mapped_column(SmallInteger)
    reenrollment_requests: Mapped[int | None] = mapped_column(SmallInteger)
    subject_code: Mapped[str] = mapped_column(ForeignKey("subjects.code"))
    # `frontEndIdTurma`: o SIGAA abre a turma por ele. Diz só que algum aluno a viu, não quem.
    front_end_id: Mapped[str | None] = mapped_column(index=True)
    statistics: Mapped[list[dict[str, object]] | None] = mapped_column(
        JSONB, deferred=True
    )
    statistics_synced_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    # As aulas pelo horário e calendário são criadas uma vez, no sync de um aluno.
    lessons_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # "Andamento das Aulas", lido na frequência de qualquer aluno da turma.
    progress_taught: Mapped[int | None] = mapped_column(SmallInteger)
    progress_total: Mapped[int | None] = mapped_column(SmallInteger)
    progress_percentage: Mapped[int | None] = mapped_column(SmallInteger)

    subject: Mapped[Subject] = relationship(back_populates="classrooms")
    # Gravados por `save_classroom_professors`, do seed ou da lista de participantes.
    professors: Mapped[list[Professor]] = relationship(
        secondary="classroom_professors",
        viewonly=True,
        lazy="selectin",
        order_by=Professor.name,
    )


class ClassroomProfessor(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "classroom_professors"
    __table_args__ = (
        UniqueConstraint("classroom_id", "professor_id", name="uq_classroom_professor"),
    )

    classroom_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("classrooms.id", ondelete="CASCADE")
    )
    professor_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("professors.id", ondelete="CASCADE"), index=True
    )


class Lesson(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Uma aula da turma, prevista pelo horário e calendário ou publicada pelo SIGAA."""

    __tablename__ = "lessons"
    __table_args__ = (
        # Uma só aula sem horário por dia.
        UniqueConstraint(
            "classroom_id",
            "occurred_on",
            "start_time",
            name="uq_lesson",
            postgresql_nulls_not_distinct=True,
        ),
    )

    classroom_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("classrooms.id", ondelete="CASCADE")
    )
    occurred_on: Mapped[dt.date] = mapped_column()
    # Horário de Brasília; vazio só na aula que o SIGAA publicou numa turma sem horário.
    start_time: Mapped[dt.time | None] = mapped_column()
    end_time: Mapped[dt.time | None] = mapped_column()
    # Está no plano; as demais o SIGAA publicou fora dele (ex.: reposição).
    scheduled: Mapped[bool] = mapped_column()


class RestaurantMenu(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "restaurant_menus"
    __table_args__ = (
        UniqueConstraint("campus", "date", name="uq_restaurant_menu_campus_date"),
    )

    campus: Mapped[str] = mapped_column()
    date: Mapped[dt.date] = mapped_column()
    breakfast: Mapped[list[dict[str, object]] | None] = mapped_column(JSONB)
    lunch: Mapped[list[dict[str, object]] | None] = mapped_column(JSONB)
    dinner: Mapped[list[dict[str, object]] | None] = mapped_column(JSONB)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class SharedStatistics(Base, TimestampMixin):
    """Turma cujas estatísticas um aluno liberou nos índices públicos.

    `sharer_key` é um HMAC da matrícula com a turma: deixa o mesmo aluno desfazer, mas não liga
    duas turmas ao mesmo aluno nem volta à matrícula.
    """

    __tablename__ = "shared_statistics"

    classroom_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("classrooms.id", ondelete="CASCADE"), primary_key=True
    )
    sharer_key: Mapped[str] = mapped_column(primary_key=True)


class ClassroomGroup(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Grupo de conversa da turma que qualquer aluno cadastra e edita; não guarda o autor."""

    __tablename__ = "classroom_groups"

    classroom_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("classrooms.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(SmallInteger)
    platform: Mapped[str] = mapped_column()
    url: Mapped[str] = mapped_column(Encrypted("groups.url"))
    # Só no Aprender 3: a chave de inscrição da disciplina.
    password: Mapped[str | None] = mapped_column(Encrypted("groups.password"))


class DemoRecord(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Linha criada pelos dados de demonstração, para apagá-la depois sem tocar nos reais."""

    __tablename__ = "demo_records"

    kind: Mapped[str] = mapped_column()
    record_id: Mapped[uuid.UUID] = mapped_column()


class ProfessorReview(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Avaliação anônima de um docente: nada de quem avaliou é guardado.

    `token_hash` é o hash de um segredo aleatório que só o navegador de quem avaliou tem,
    para poder editar ou apagar a própria avaliação.
    """

    __tablename__ = "professor_reviews"

    semester: Mapped[str | None] = mapped_column()
    criteria: Mapped[dict[str, int | None] | None] = mapped_column(
        JSONB(none_as_null=True)
    )
    professor_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("professors.id", ondelete="CASCADE"), index=True
    )
    subject_code: Mapped[str | None] = mapped_column()
    rating: Mapped[int] = mapped_column(SmallInteger)
    comment: Mapped[str | None] = mapped_column(Encrypted("reviews.comment"))
    attendance: Mapped[str | None] = mapped_column()
    token_hash: Mapped[str] = mapped_column()


class Material(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Arquivo que um aluno compartilhou numa matéria, sem autor.

    `uploader_key` verifica a credencial aleatória deste material (gerada no navegador); não liga materiais entre si.
    """

    __tablename__ = "materials"
    __table_args__ = (
        Index("ix_materials_subject_semester", "subject_code", "semester"),
    )

    subject_code: Mapped[str] = mapped_column()
    semester: Mapped[str] = mapped_column()
    # Turma e docentes de onde o material veio, para quem é de outra turma saber.
    classroom_number: Mapped[str | None] = mapped_column()
    professors: Mapped[list[str]] = mapped_column(JSONB, default=list)
    title: Mapped[str] = mapped_column(Encrypted("materials.title"))
    kind: Mapped[str] = mapped_column()
    filename: Mapped[str] = mapped_column(Encrypted("materials.filename"))
    mime: Mapped[str] = mapped_column()
    size: Mapped[int] = mapped_column()
    sha256: Mapped[str] = mapped_column()
    storage_key: Mapped[str] = mapped_column(unique=True)
    uploader_key: Mapped[str | None] = mapped_column(index=True)


class Report(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Denúncia ou pedido de exclusão de um conteúdo da comunidade, para a moderação."""

    __tablename__ = "reports"
    __table_args__ = (Index("ix_reports_status", "status", "created_at"),)

    target_type: Mapped[str] = mapped_column()
    target_id: Mapped[uuid.UUID] = mapped_column()
    reason: Mapped[str] = mapped_column()
    message: Mapped[str | None] = mapped_column(Encrypted("reports.message"))
    # pending, accepted (conteúdo apagado) ou rejected.
    status: Mapped[str] = mapped_column(default="pending")
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Tutorial(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Guia escrito pela comunidade; só aparece depois de aprovado pela moderação."""

    __tablename__ = "tutorials"
    __table_args__ = (Index("ix_tutorials_status", "status", "category"),)

    title: Mapped[str] = mapped_column(Encrypted("tutorials.title"))
    summary: Mapped[str] = mapped_column(Encrypted("tutorials.summary"))
    body: Mapped[str] = mapped_column(Encrypted("tutorials.body"))
    category: Mapped[str] = mapped_column()
    # Segredo do aparelho por escopo; limita quantos guias aguardam aprovação.
    author_key: Mapped[str | None] = mapped_column(index=True)
    # pending, approved ou rejected.
    status: Mapped[str] = mapped_column(default="pending")
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ForumPost(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Dúvida ou publicação anônima da comunidade.

    `author_key` verifica a credencial aleatória desta publicação, sem identificador de aluno ou aparelho.
    """

    __tablename__ = "forum_posts"
    __table_args__ = (Index("ix_forum_posts_activity", "last_activity_at"),)

    kind: Mapped[str] = mapped_column()
    resolved: Mapped[bool] = mapped_column(default=False, server_default="false")
    title: Mapped[str] = mapped_column(Encrypted("forum.title"))
    body: Mapped[str] = mapped_column(Encrypted("forum.body"))
    campus: Mapped[str | None] = mapped_column()
    course_id: Mapped[int | None] = mapped_column()
    subject_code: Mapped[str | None] = mapped_column()
    author_key: Mapped[str | None] = mapped_column()
    reply_count: Mapped[int] = mapped_column(default=0)
    last_activity_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class ForumReply(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "forum_replies"

    post_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("forum_posts.id", ondelete="CASCADE"), index=True
    )
    body: Mapped[str] = mapped_column(Encrypted("forum.reply"))
    # Verificador da credencial desta resposta (aleatória, só dela); nulo depois de migrada de dados antigos.
    author_key: Mapped[str | None] = mapped_column()
    # Quem abriu a conversa provou, ao responder, que tem a chave da publicação: sem ligar nada além disso.
    by_op: Mapped[bool] = mapped_column(default=False)


class ActiveUser(Base):
    """Uso anônimo: uma chave por aluno e período (dia, semana ou mês), sem ligar os períodos."""

    __tablename__ = "active_users"

    # `d:2026-11-08`, `w:2026-W45` ou `m:2026-11`.
    period: Mapped[str] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(primary_key=True)


class SystemFlag(Base, TimestampMixin):
    """Liga e desliga partes do sistema pelo painel do administrador."""

    __tablename__ = "system_flags"

    key: Mapped[str] = mapped_column(primary_key=True)
    enabled: Mapped[bool] = mapped_column()


class AdminLog(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """O que o administrador fez, para auditoria."""

    __tablename__ = "admin_log"

    action: Mapped[str] = mapped_column()
    target_type: Mapped[str | None] = mapped_column()
    target_id: Mapped[str | None] = mapped_column()
    detail: Mapped[str | None] = mapped_column(Encrypted("admin.log.detail"))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("admin_accounts.id"), index=True
    )
    actor_role: Mapped[str | None] = mapped_column()


class SystemText(Base, TimestampMixin):
    """Textos que o administrador muda pelo painel (ex.: o link do bot do Telegram)."""

    __tablename__ = "system_texts"

    key: Mapped[str] = mapped_column(primary_key=True)
    value: Mapped[str] = mapped_column(Text)
