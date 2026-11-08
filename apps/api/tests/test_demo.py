import pytest
from pydantic import SecretStr
from sigaa_client import Classroom as SigaaClassroom
from sigaa_client import Credentials
from sigaa_client import Subject as SigaaSubject
from sqlalchemy import func, select

from api.core.config import settings
from api.db.models import (
    Classroom,
    ClassroomGroup,
    ClassroomProfessor,
    Professor,
    ProfessorReview,
    Subject,
)

CREDENCIAIS = Credentials(registration="251000000", password=SecretStr("senha123"))
WHATSAPP = "https://chat.whatsapp.com/Real"


@pytest.fixture
def aluno(database, stub_sigaa):
    # As turmas do aluno vêm do SIGAA: o banco não sabe quem cursa o quê.
    stub_sigaa.classrooms.list_classrooms.return_value = [
        SigaaClassroom(
            id=f"T{index}",
            number=number,
            semester="2026.2",
            current=True,
            subject=SigaaSubject(code=code, name=name),
        )
        for index, (code, name, number) in enumerate(
            [("FGA0030", "ED2", "02"), ("FGA0003", "C1", "01")]
        )
    ]
    with database.begin() as session:
        session.add_all(
            [Subject(code="FGA0030", name="ED2"), Subject(code="FGA0003", name="C1")]
        )
        professor = Professor(siape=111, name="MAURICIO SERRANO", unit_id=673)
        atual = Classroom(subject_code="FGA0030", number="02", semester="2026.2")
        com_grupo = Classroom(subject_code="FGA0003", number="01", semester="2026.2")
        session.add_all([professor, atual, com_grupo])
        session.flush()
        session.add(
            ClassroomProfessor(classroom_id=atual.id, professor_id=professor.id)
        )
        session.add(
            ClassroomGroup(
                classroom_id=com_grupo.id, position=0, platform="whatsapp", url=WHATSAPP
            )
        )


@pytest.fixture
def logado(client, cookies, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "demo_data", True)
    monkeypatch.setattr(settings, "materials_dir", str(tmp_path))
    client.cookies.update(cookies(refresh=CREDENCIAIS))
    return client


def _count(database, model):
    with database() as session:
        return session.scalar(select(func.count()).select_from(model))


def test_desligado_responde_404(client, cookies, monkeypatch):
    monkeypatch.setattr(settings, "demo_data", False)
    client.cookies.update(cookies(refresh=CREDENCIAIS))
    assert client.get("/demo").status_code == 404
    assert client.post("/demo").status_code == 404


def test_carrega_dados_das_turmas_do_aluno_e_apaga_so_os_ficticios(
    logado, aluno, database, tmp_path
):
    assert logado.get("/demo").json()["loaded"] is False

    status = logado.post("/demo").json()
    assert status["loaded"] is True
    # só a turma sem grupo ganha os de demonstração
    assert status["groups"] == 2
    # duas turmas passadas por matéria atual
    assert status["classrooms"] == 4
    assert status["reviews"] >= 2
    assert status["materials"] >= 2
    assert status["posts"] == 5
    assert status["tutorials"] == 4
    materiais = logado.get("/materials/FGA0030").json()["items"]
    assert logado.get(f"/materials/FGA0030/{materiais[0]['id']}").status_code == 200
    assert len(logado.get("/tutorials").json()) == 3

    grupos = logado.get("/groups/FGA0030/2026.2/02").json()["groups"]
    assert [group["platform"] for group in grupos] == ["whatsapp", "aprender3"]
    reviews = logado.get("/public/professors/111/reviews").json()
    assert reviews["summary"]["count"] >= 2
    outcomes = logado.get("/public/subjects/FGA0030/outcomes").json()
    assert outcomes["subject"]["classrooms"] == 2
    assert outcomes["professors"][0]["siape"] == 111

    # carregar de novo não duplica
    assert logado.post("/demo").json() == status

    apagado = logado.delete("/demo").json()
    assert apagado == {
        "loaded": False,
        "groups": 0,
        "reviews": 0,
        "classrooms": 0,
        "materials": 0,
        "posts": 0,
        "tutorials": 0,
    }
    assert not [f for f in tmp_path.rglob("*") if f.is_file()]
    assert _count(database, ProfessorReview) == 0
    assert _count(database, Classroom) == 2
    with database() as session:
        assert session.scalars(select(ClassroomGroup.url)).all() == [WHATSAPP]


def test_notas_em_lote_trazem_a_chamada(logado, aluno):
    logado.post("/reviews", json={"siape": 111, "rating": 80, "attendance": "cobra"})
    logado.post("/reviews", json={"siape": 111, "rating": 60, "attendance": "varia"})
    logado.post("/reviews", json={"siape": 111, "rating": 70})
    assert logado.get("/public/professors/ratings?siape=111").json() == {
        "111": {
            "count": 3,
            "average": 70.0,
            "attendance": {"cobra": 1, "nao_cobra": 0, "varia": 1},
        }
    }
