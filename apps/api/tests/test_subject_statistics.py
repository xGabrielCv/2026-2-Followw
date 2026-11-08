from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sigaa_client import Classroom as SigaaClassroom
from sigaa_client import Credentials, StudentSituation
from sigaa_client import StatisticsShare as StatisticsShareModel
from sigaa_client import Subject as SigaaSubject
from sqlalchemy import select

from api.db.main import get_database
from api.db.models import (
    Classroom,
    ClassroomProfessor,
    Professor,
    SharedStatistics,
    Subject,
)
from api.modules.public_subjects import statistics
from api.modules.public_subjects.router import router

CREDENCIAIS = Credentials(registration="251000000", password=SecretStr("senha123"))


def _link(session, classroom, *professors, shared=True):
    session.flush()
    session.add_all(
        ClassroomProfessor(classroom_id=classroom.id, professor_id=professor.id)
        for professor in professors
    )
    # só entram nos índices as turmas cujas estatísticas algum aluno liberou
    if shared:
        session.add(SharedStatistics(classroom_id=classroom.id, sharer_key="teste"))


def _shares(approved):
    return [
        {"situation": "aprovado", "percentage": approved},
        {"situation": "reprovado", "percentage": 100 - approved},
    ]


@pytest.fixture
def statistics_client(monkeypatch):
    repository = SimpleNamespace(
        classroom_professors=AsyncMock(return_value=["Ana", "João"]),
        historical_statistics=AsyncMock(return_value=[]),
    )
    monkeypatch.setattr(
        statistics, "SubjectCatalogRepository", lambda session: repository
    )

    class Database:
        async def read(self, load):
            return await load(None)

    app = FastAPI()
    app.include_router(router, prefix="/public/subjects")
    app.dependency_overrides[get_database] = Database
    with TestClient(app) as client:
        yield client, repository


def _get(client, **params):
    return client.get(
        "/public/subjects/FGA0003/statistics",
        params={"semester": "2026.2", "number": "01", **params},
    )


def test_media_geral_da_peso_igual_as_turmas_e_preserva_situacoes(statistics_client):
    client, repository = statistics_client
    repository.historical_statistics.return_value = [
        ("2026.1", ["João", "Ana"], _shares(90)),
        ("2026.1", ["Ana", "João"], [{"situation": "aprovado", "percentage": 100}]),
        ("2025.2", ["Ana", "João"], _shares(20)),
        ("2025.2", ["Ana"], _shares(0)),
        ("2025.2", ["Ana", "João", "Outro"], _shares(0)),
        ("2025.1", ["Ana", "João"], None),
        ("2025.1", ["Ana", "João"], []),
    ]
    response = _get(client)
    assert response.status_code == 200
    assert "no-store" in response.headers["cache-control"]
    result = response.json()
    assert result["overall"] == {
        "semester": None,
        "classrooms": 3,
        "shares": _shares(70),
    }
    assert result["semesters"] == [
        {"semester": "2026.1", "classrooms": 2, "shares": _shares(95)},
        {"semester": "2025.2", "classrooms": 1, "shares": _shares(20)},
    ]
    repository.classroom_professors.assert_awaited_once_with("FGA0003", "2026.2", "01")
    repository.historical_statistics.assert_awaited_once_with("FGA0003", "2026.2")


@pytest.mark.parametrize("professors", [[], ["Ana"], ["Ana", "João"]])
def test_sem_historico_compativel_retorna_estatisticas_vazias(
    statistics_client, professors
):
    client, repository = statistics_client
    repository.classroom_professors.return_value = professors
    repository.historical_statistics.return_value = [
        ("2026.1", ["Outro"], _shares(100))
    ]
    assert _get(client).json() == {
        "overall": {"semester": None, "classrooms": 0, "shares": []},
        "semesters": [],
    }


def test_turma_individual_nao_usa_historico_compartilhado(statistics_client):
    client, repository = statistics_client
    repository.classroom_professors.return_value = ["Ana"]
    repository.historical_statistics.return_value = [
        ("2026.1", ["Ana", "João"], _shares(0)),
        ("2025.2", ["Ana"], _shares(80)),
    ]
    assert _get(client).json()["overall"]["shares"] == _shares(80)


def test_preserva_todas_as_situacoes_do_sigaa(statistics_client):
    client, repository = statistics_client
    shares = [
        {"situation": situation.value, "percentage": 11.1}
        for situation in StudentSituation
    ]
    repository.historical_statistics.return_value = [
        ("2026.1", ["Ana", "João"], shares)
    ]
    assert _get(client).json()["overall"]["shares"] == shares


def test_turma_inexistente_retorna_404(statistics_client):
    client, repository = statistics_client
    repository.classroom_professors.return_value = None
    assert _get(client).status_code == 404


@pytest.mark.parametrize("params", [{"semester": "invalido"}, {"number": ""}])
def test_parametros_invalidos_nao_consultam_o_banco(statistics_client, params):
    client, repository = statistics_client
    assert _get(client, **params).status_code == 422
    repository.classroom_professors.assert_not_awaited()


def test_consulta_real_exclui_outros_componentes_e_semestres_atuais_e_futuros(
    client, database
):
    with database.begin() as session:
        session.add_all(
            [
                Subject(code="FGA0003", name="Matéria"),
                Subject(code="FGA0004", name="Outra"),
            ]
        )
        ana = Professor(name="Ana")
        classrooms = [
            Classroom(subject_code=code, semester=semester, number="01", statistics=s)
            for code, semester, s in [
                ("FGA0003", "2026.2", _shares(0)),
                ("FGA0003", "2027.1", _shares(0)),
                ("FGA0004", "2026.1", _shares(0)),
                ("FGA0003", "2026.1", _shares(80)),
            ]
        ]
        session.add_all([ana, *classrooms])
        for classroom in classrooms:
            _link(session, classroom, ana)
    result = _get(client).json()
    assert result["overall"]["classrooms"] == 1
    assert result["overall"]["shares"] == _shares(80)
    assert [item["semester"] for item in result["semesters"]] == ["2026.1"]


@pytest.mark.parametrize("team", [["Ana"], ["Ana", "João"]])
def test_consulta_real_compara_os_docentes_vinculados_sem_misturar_equipes(
    client, database, team
):
    with database.begin() as session:
        session.add(Subject(code="FGA0003", name="Matéria"))
        people = {name: Professor(name=name) for name in ["Ana", "João", "Outro"]}
        current, previous, different = [
            Classroom(
                subject_code="FGA0003", semester=semester, number=number, statistics=s
            )
            for semester, number, s in [
                ("2026.2", "01", None),
                ("2026.1", "01", _shares(80)),
                ("2026.1", "02", _shares(0)),
            ]
        ]
        session.add_all([*people.values(), current, previous, different])
        professors = [people[name] for name in team]
        _link(session, current, *professors)
        _link(session, previous, *professors)
        _link(session, different, *professors, people["Outro"])

    response = _get(client)
    assert response.status_code == 200
    assert response.json()["overall"] == {
        "semester": None,
        "classrooms": 1,
        "shares": _shares(80),
    }


def _classroom(session, code, number, semester, shares, *professors, shared=True):
    classroom = Classroom(
        subject_code=code,
        semester=semester,
        number=number,
        statistics=shares,
        statistics_synced_at=datetime.now(UTC) if shares is not None else None,
    )
    session.add(classroom)
    _link(session, classroom, *professors, shared=shared)


def test_indices_da_materia_somam_todas_as_turmas_e_separam_por_docente(
    client, database
):
    with database.begin() as session:
        session.add_all(
            [Subject(code="FGA0003", name="A"), Subject(code="FGA0004", name="B")]
        )
        ana = Professor(name="ANA SOUZA", siape=123)
        # a mesma docente vista só numa turma, sem SIAPE e com acento diferente
        ana_turma = Professor(name="Ana Souza ")
        joao = Professor(name="JOÃO LIMA")
        novo = Professor(name="NOVO DOCENTE")
        session.add_all([ana, ana_turma, joao, novo])
        trancada = [
            *_shares(70)[:1],
            {"situation": "reprovado_por_faltas", "percentage": 10},
        ]
        trancada.append({"situation": "trancado", "percentage": 20})
        _classroom(session, "FGA0003", "01", "2025.1", _shares(90), ana)
        _classroom(session, "FGA0003", "02", "2025.2", trancada, ana_turma, joao)
        _classroom(session, "FGA0004", "01", "2025.2", _shares(50), ana)
        _classroom(session, "FGA0003", "03", "2026.2", None, novo)

    result = client.get("/public/subjects/FGA0003/outcomes").json()

    assert result["subject"] == {
        "classrooms": 2,
        "approved": 80.0,
        "failed": 10.0,
        "dropped": 10.0,
    }
    by_name = {item["name"]: item for item in result["professors"]}
    assert set(by_name) == {"ANA SOUZA", "JOÃO LIMA", "NOVO DOCENTE"}
    assert by_name["ANA SOUZA"]["siape"] == 123
    assert by_name["ANA SOUZA"]["subject"]["classrooms"] == 2
    # na FGA0004 ela reprova mais: o geral junta as três turmas
    assert by_name["ANA SOUZA"]["overall"] == {
        "classrooms": 3,
        "approved": 70.0,
        "failed": 23.3,
        "dropped": 6.7,
    }
    assert by_name["JOÃO LIMA"]["subject"]["failed"] == 10.0
    assert by_name["NOVO DOCENTE"] == {
        "name": "NOVO DOCENTE",
        "siape": None,
        "subject": None,
        "overall": None,
    }


def test_indices_do_docente_por_materia_e_404_sem_cadastro(client, database):
    with database.begin() as session:
        session.add_all(
            [Subject(code="FGA0003", name="A"), Subject(code="FGA0004", name="B")]
        )
        ana = Professor(name="ANA SOUZA", siape=123)
        session.add(ana)
        _classroom(session, "FGA0003", "01", "2025.1", _shares(90), ana)
        _classroom(session, "FGA0004", "01", "2025.2", _shares(50), ana)

    result = client.get("/public/professors/123/outcomes").json()

    assert result["overall"]["classrooms"] == 2
    assert result["overall"]["failed"] == 30.0
    assert [(item["code"], item["rates"]["failed"]) for item in result["subjects"]] == [
        ("FGA0003", 10.0),
        ("FGA0004", 50.0),
    ]
    assert client.get("/public/professors/999/outcomes").status_code == 404
    assert client.get("/public/subjects/XYZ0001/outcomes").status_code == 404


def test_so_entram_turmas_de_quem_compartilha_as_estatisticas(
    client, database, cookies, stub_sigaa, qstash
):
    with database.begin() as session:
        session.add(Subject(code="FGA0003", name="A"))
        ana = Professor(name="ANA SOUZA", siape=123)
        session.add(ana)
        _classroom(session, "FGA0003", "01", "2025.1", _shares(90), ana)
        _classroom(session, "FGA0003", "02", "2025.1", _shares(0), ana, shared=False)
        _classroom(session, "FGA0003", "03", "2026.2", None, ana)

    outcomes = client.get("/public/subjects/FGA0003/outcomes").json()
    assert outcomes["subject"]["classrooms"] == 1
    assert outcomes["subject"]["failed"] == 10.0
    historico = _get(client, number="03").json()
    assert historico["overall"]["classrooms"] == 1

    # o aluno da turma 02 libera as estatísticas das turmas dele; a lista vem do SIGAA
    stub_sigaa.classrooms.list_classrooms.return_value = [
        SigaaClassroom(
            id="TURMA02",
            number="02",
            semester="2025.1",
            subject=SigaaSubject(code="FGA0003", name="A"),
        )
    ]
    client.cookies.update(cookies(refresh=CREDENCIAIS))
    status = client.put("/me/statistics-sharing", json={"shared": True}).json()
    assert status == {"shared": True, "classrooms": 1, "pending": False}
    # a turma já tinha índice: nada a buscar em segundo plano
    assert qstash.published == []
    # repetir não duplica
    client.put("/me/statistics-sharing", json={"shared": True})
    outcomes = client.get("/public/subjects/FGA0003/outcomes").json()
    assert outcomes["subject"]["classrooms"] == 2

    client.put("/me/statistics-sharing", json={"shared": False})
    outcomes = client.get("/public/subjects/FGA0003/outcomes").json()
    assert outcomes["subject"]["classrooms"] == 1
    # o compartilhamento não guarda a matrícula de ninguém
    with database() as session:
        keys = session.scalars(select(SharedStatistics.sharer_key)).all()
    assert all("251000000" not in key for key in keys)


def test_liberar_busca_num_job_os_indices_que_faltam(
    client, database, cookies, stub_sigaa, qstash
):
    with database.begin() as session:
        session.add(Subject(code="FGA0003", name="A"))
    stub_sigaa.classrooms.list_classrooms.return_value = [
        SigaaClassroom(
            id="TURMA05",
            number="05",
            semester="2025.1",
            subject=SigaaSubject(code="FGA0003", name="A"),
        )
    ]
    stub_sigaa.classrooms.get_classroom_statistics.return_value = (
        StatisticsShareModel(situation=StudentSituation.APROVADO, percentage=70),
        StatisticsShareModel(situation=StudentSituation.REPROVADO, percentage=30),
    )
    client.cookies.update(cookies(refresh=CREDENCIAIS))

    status = client.put("/me/statistics-sharing", json={"shared": True}).json()

    assert status == {"shared": True, "classrooms": 0, "pending": True}
    [job] = qstash.jobs()
    assert job.task == "share_statistics"
    # a Upstash não vê a matrícula, nem no controle de fluxo
    assert "251000000" not in str(qstash.published[0]["headers"])
    # o job (entregue antes da resposta, como o QStash faria) buscou e liberou
    outcomes = client.get("/public/subjects/FGA0003/outcomes").json()
    assert outcomes["subject"]["classrooms"] == 1
    assert outcomes["subject"]["failed"] == 30.0


def test_comparacao_traz_medias_da_unb_e_do_curso_sem_dado_do_aluno(client, database):
    from api.db.models import Course, Curriculum, CurriculumComponent

    with database.begin() as session:
        session.add_all(
            [Subject(code="FGA0003", name="A"), Subject(code="MAT0001", name="B")]
        )
        ana = Professor(name="ANA SOUZA", siape=123)
        session.add(ana)
        _classroom(session, "FGA0003", "01", "2025.1", _shares(60), ana)
        _classroom(session, "MAT0001", "01", "2025.1", _shares(90), ana)
        # sem liberação: não entra
        _classroom(session, "MAT0001", "02", "2025.1", _shares(0), ana, shared=False)
        course = Course(name="SOFTWARE", unit_id=673)
        session.add(course)
        session.flush()
        curriculum = Curriculum(
            course_id=course.id,
            sigaa_id=1,
            code="1",
            valid_from="2020.1",
            created_year=2020,
            active=True,
            matrix="X",
        )
        session.add(curriculum)
        session.flush()
        session.add(
            CurriculumComponent(
                curriculum_id=curriculum.id,
                subject_code="FGA0003",
                kind="required",
                period=1,
            )
        )
        course_id = course.id

    geral = client.get("/public/subjects/comparison").json()
    assert geral["unb"]["classrooms"] == 2 and geral["unb"]["approved"] == 75.0
    assert geral["course"] is None
    assert [s["code"] for s in geral["subjects"]] == ["FGA0003", "MAT0001"]
    curso = client.get(
        "/public/subjects/comparison", params={"course": course_id}
    ).json()
    assert curso["course"]["approved"] == 60.0
    assert [s["code"] for s in curso["subjects"]] == ["FGA0003"]
