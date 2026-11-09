"""Catálogo inteiramente sintético para E2E/carga; nunca importa dados coletados do usuário."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import insert, text


def seed(connection) -> None:
    connection.execute(
        text(
            "INSERT INTO units (id, code, name) VALUES (673, 'FCTE', 'CAMPUS UNB GAMA')"
        )
    )
    connection.execute(
        text(
            "INSERT INTO courses (id, sigaa_id, name, unit_id) VALUES (1, 100001, 'ENGENHARIA DE SOFTWARE', 673)"
        )
    )
    for code, name in [
        ("FGA0146", "ESTRUTURAS DE DADOS 1"),
        ("FGA0158", "ORIENTAÇÃO A OBJETOS"),
        ("MAT0025", "CÁLCULO 1"),
        ("FGA0302", "ENGENHARIA E AMBIENTE"),
        ("FGA0161", "ENGENHARIA E AMBIENTE ANTIGA"),
        ("FGA0001", "TÓPICOS OPTATIVOS SINTÉTICOS"),
    ]:
        connection.execute(
            text(
                "INSERT INTO subjects (code, name, hours, unit_id) VALUES (:code, :name, 60, 673)"
            ),
            {"code": code, "name": name},
        )
    from api.db.models import (
        Classroom,
        ClassroomGroup,
        ClassroomProfessor,
        Curriculum,
        CurriculumComponent,
        ForumPost,
        Professor,
        ProfessorReview,
        Subject,
        Tutorial,
    )

    connection.execute(
        Subject.__table__.update()
        .where(Subject.code == "FGA0161")
        .values(equivalences=[["FGA0302"]])
    )
    connection.execute(
        Subject.__table__.update()
        .where(Subject.code == "FGA0158")
        .values(prerequisites=[["FGA0146"]])
    )
    professor = UUID("10000000-0000-4000-8000-000000000001")
    connection.execute(
        insert(Professor).values(
            id=professor,
            siape=1000001,
            name="DOCENTE SINTÉTICO",
            unit_id=673,
            disciplines=[],
        )
    )
    curriculum = UUID("20000000-0000-4000-8000-000000000001")
    connection.execute(
        insert(Curriculum).values(
            id=curriculum,
            course_id=1,
            sigaa_id=100001,
            code="SINTETICO-2026",
            valid_from="2026.1",
            created_year=2026,
            active=True,
            shift="D",
            matrix="Currículo sintético",
            total_workload=3600,
            required_workload=2100,
            optional_min_workload=480,
            complementary_min_workload=240,
            elective_max_workload=360,
            period_max_workload=480,
            period_min_workload=120,
            min_semesters=8,
            avg_semesters=10,
            max_semesters=15,
        )
    )
    for index, code in enumerate(
        ["MAT0025", "FGA0146", "FGA0158", "FGA0302", "FGA0001"]
    ):
        connection.execute(
            insert(CurriculumComponent).values(
                curriculum_id=curriculum,
                subject_code=code,
                period=0 if index == 4 else index + 1,
                kind="optional" if index == 4 else "required",
            )
        )
    for index, (code, number, semester, front, schedule) in enumerate(
        [
            ("FGA0146", "01", "2026.2", "AAA", "24M12"),
            ("FGA0158", "02", "2025.2", "BBB", "35T12"),
            ("MAT0025", "01", "2027.1", None, "24M34"),
            ("FGA0158", "01", "2027.1", None, "35T12"),
        ],
        1,
    ):
        classroom = UUID(f"30000000-0000-4000-8000-{index:012d}")
        connection.execute(
            insert(Classroom).values(
                id=classroom,
                subject_code=code,
                number=number,
                semester=semester,
                front_end_id=front,
                schedule=schedule,
                room="SALA SINTÉTICA 1",
                vacancies=40,
                occupied=20,
            )
        )
        connection.execute(
            insert(ClassroomProfessor).values(
                classroom_id=classroom, professor_id=professor
            )
        )
    connection.execute(
        insert(ClassroomGroup).values(
            classroom_id=UUID("30000000-0000-4000-8000-000000000001"),
            position=0,
            platform="whatsapp",
            url="https://chat.whatsapp.com/GrupoSinteticoSemConviteReal",
        )
    )
    connection.execute(
        insert(ProfessorReview).values(
            professor_id=professor,
            subject_code="FGA0146",
            rating=80,
            comment="Avaliação sintética para navegação pública.",
            attendance="cobra",
            token_hash="somente-fixture",
            semester="2026.2",
            criteria={"clarity": 4},
        )
    )
    connection.execute(
        insert(ForumPost).values(
            id=UUID("40000000-0000-4000-8000-000000000001"),
            kind="duvida",
            title="Como estudar estruturas de dados?",
            body="Pergunta sintética para testar a leitura pública.",
            subject_code="FGA0146",
            author_key=None,
        )
    )
    connection.execute(
        insert(Tutorial).values(
            id=UUID("50000000-0000-4000-8000-000000000001"),
            title="Guia sintético de matrícula",
            summary="Orientações de demonstração para testes locais.",
            body="Guia exclusivamente sintético para validar a navegação pública e o leitor de texto.",
            category="matricula",
            status="approved",
            approved_at=datetime.now(UTC),
            author_key=None,
        )
    )
