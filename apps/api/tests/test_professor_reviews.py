import pytest
from pydantic import SecretStr
from sigaa_client import Credentials
from sqlalchemy import inspect

from api.db.models import (
    Classroom,
    ClassroomProfessor,
    Professor,
    ProfessorReview,
    Subject,
)

CREDENCIAIS = Credentials(registration="251000000", password=SecretStr("senha123"))


@pytest.fixture
def docentes(database):
    with database.begin() as session:
        session.add_all(
            [
                Subject(code="FGA0211", name="FUNDAMENTOS DE REDES DE COMPUTADORES"),
                Subject(code="FGA0003", name="COMPILADORES 1"),
            ]
        )
        tiago = Professor(
            siape=111, name="TIAGO ALVES FONSECA", unit_id=673, disciplines=[]
        )
        ana = Professor(
            siape=222,
            unit_id=673,
            name="ANA SOUZA",
            disciplines=[{"semester": "2026.2", "code": "FGA0003", "occurrences": 1}],
        )
        bruno = Professor(siape=333, name="BRUNO LIMA", unit_id=673, disciplines=[])
        # visto só numa turma de redes: casa com o Tiago do catálogo pelo nome
        tiago_turma = Professor(name="Tiago Alves Fonseca")
        session.add_all([tiago, ana, bruno, tiago_turma])
        session.flush()
        redes = Classroom(subject_code="FGA0211", number="01", semester="2026.2")
        session.add(redes)
        session.flush()
        session.add(
            ClassroomProfessor(classroom_id=redes.id, professor_id=tiago_turma.id)
        )


@pytest.fixture
def logado(client, cookies):
    client.cookies.update(cookies(refresh=CREDENCIAIS))
    return client


def _avaliar(client, siape, rating, **body):
    response = client.post("/reviews", json={"siape": siape, "rating": rating, **body})
    assert response.status_code == 201, response.text
    return response.json()


def test_avaliar_exige_login_e_docente_do_catalogo(client, docentes, cookies):
    assert client.post("/reviews", json={"siape": 111, "rating": 80}).status_code == 401
    client.cookies.update(cookies(refresh=CREDENCIAIS))
    assert client.post("/reviews", json={"siape": 999, "rating": 80}).status_code == 404


@pytest.mark.parametrize(
    "body",
    [
        {"rating": -1},
        {"rating": 101},
        {"rating": 50, "attendance": "sempre"},
        {"rating": 50, "comment": "a" * 1001},
        {"rating": 50, "subject": "FGA 0211"},
    ],
)
def test_avaliacao_invalida_retorna_422(logado, docentes, body):
    assert logado.post("/reviews", json={"siape": 111, **body}).status_code == 422


def test_avaliacao_anonima_aparece_no_perfil_com_media_e_chamada(logado, docentes):
    criada = _avaliar(
        logado,
        111,
        90,
        comment="  Explica muito bem.  ",
        attendance="cobra",
        subject="fga0211",
    )
    assert len(criada["token"]) >= 32
    review = criada["review"]
    assert review["comment"] == "Explica muito bem."
    assert review["subject"] == {
        "code": "FGA0211",
        "name": "FUNDAMENTOS DE REDES DE COMPUTADORES",
    }
    assert len(review["month"]) == 7
    _avaliar(logado, 111, 71, attendance="varia")
    _avaliar(logado, 111, 60, comment="   ")

    logado.cookies.clear()
    perfil = logado.get("/public/professors/111/reviews")
    assert perfil.status_code == 200
    data = perfil.json()
    assert data["summary"] == {
        "count": 3,
        "average": 73.7,
        "attendance": {"cobra": 1, "nao_cobra": 0, "varia": 1},
    }
    assert [item["rating"] for item in data["reviews"]] == [60, 71, 90]
    assert data["reviews"][0]["comment"] is None
    assert "token" not in str(data)

    assert logado.get("/public/professors/222/reviews").json() == {
        "summary": None,
        "reviews": [],
    }
    assert logado.get("/public/professors/999/reviews").status_code == 404

    # nenhuma coluna liga a avaliação a quem avaliou
    assert {column.key for column in inspect(ProfessorReview).columns} == {
        "id",
        "professor_id",
        "subject_code",
        "rating",
        "comment",
        "attendance",
        "token_hash",
        "created_at",
        "updated_at",
    }


def test_so_quem_tem_o_segredo_edita_ou_apaga(client, logado, docentes):
    criada = _avaliar(logado, 111, 40)
    review_id, token = criada["review"]["id"], criada["token"]

    logado.cookies.clear()
    errado = {"X-Review-Token": "x" * 43}
    corpo = {"rating": 85, "attendance": "nao_cobra"}
    assert (
        client.put(f"/reviews/{review_id}", json=corpo, headers=errado).status_code
        == 404
    )
    assert client.delete(f"/reviews/{review_id}", headers=errado).status_code == 404

    certo = {"X-Review-Token": token}
    editada = client.put(f"/reviews/{review_id}", json=corpo, headers=certo)
    assert editada.status_code == 200
    assert editada.json()["rating"] == 85
    assert editada.json()["attendance"] == "nao_cobra"
    assert (
        client.get("/public/professors/111/reviews").json()["summary"]["average"] == 85
    )

    assert client.delete(f"/reviews/{review_id}", headers=certo).status_code == 204
    assert client.get("/public/professors/111/reviews").json()["summary"] is None
    assert client.delete(f"/reviews/{review_id}", headers=certo).status_code == 404


def test_notas_de_varios_docentes_de_uma_vez(logado, docentes):
    _avaliar(logado, 111, 80)
    _avaliar(logado, 111, 61)
    _avaliar(logado, 222, 30)

    response = logado.get("/public/professors/ratings?siape=111&siape=222&siape=333")
    assert response.status_code == 200
    assert response.json() == {
        "111": {
            "count": 2,
            "average": 70.5,
            "attendance": {"cobra": 0, "nao_cobra": 0, "varia": 0},
        },
        "222": {
            "count": 1,
            "average": 30.0,
            "attendance": {"cobra": 0, "nao_cobra": 0, "varia": 0},
        },
    }
    assert logado.get("/public/professors/ratings").status_code == 422


def test_ranking_conta_sem_avaliacao_como_zero_e_filtra_pela_materia(logado, docentes):
    _avaliar(logado, 111, 90)
    _avaliar(logado, 222, 40)

    def ranking(**params):
        page = logado.get("/public/professors", params=params).json()
        return [(item["siape"], item["rating"]) for item in page["items"]]

    assert ranking(order="best") == [
        (111, {"count": 1, "average": 90.0}),
        (222, {"count": 1, "average": 40.0}),
        (333, None),
    ]
    assert [siape for siape, _ in ranking(order="worst")] == [333, 222, 111]
    assert [siape for siape, _ in ranking(order="worst", rated="true")] == [222, 111]
    # pela turma (nome visto na turma) e pelo histórico de disciplinas do catálogo
    assert [siape for siape, _ in ranking(subject="redes de computadores")] == [111]
    assert [siape for siape, _ in ranking(subject="fga0003")] == [222]
    assert ranking(subject="inexistente") == []
    assert logado.get("/public/professors?order=pior").status_code == 422
