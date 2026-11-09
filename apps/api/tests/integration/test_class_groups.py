import pytest
from pydantic import SecretStr
from sigaa_client import Credentials
from sqlalchemy import inspect, select

from api.db.models import (
    Classroom,
    ClassroomGroup,
    ClassroomProfessor,
    Professor,
    Subject,
)

CREDENCIAIS = Credentials(registration="251000000", password=SecretStr("senha123"))
WHATSAPP = "https://chat.whatsapp.com/AbCdEf123"
TURMA = "/groups/FGA0003/2026.2/01"


def test_links_repetidos_credenciais_na_url_e_portas_alternativas_sao_recusados(
    logado, turmas
):
    for groups in [
        [
            {"platform": "whatsapp", "url": WHATSAPP},
            {"platform": "whatsapp", "url": WHATSAPP + "/#convite"},
        ],
        [
            {
                "platform": "whatsapp",
                "url": "https://segredo@chat.whatsapp.com/AbCdEf123",
            }
        ],
        [{"platform": "whatsapp", "url": "https://chat.whatsapp.com:1234/AbCdEf123"}],
    ]:
        assert logado.put(TURMA, json={"groups": groups}).status_code == 422


@pytest.fixture
def turmas(database):
    with database.begin() as session:
        session.add_all(
            [
                Subject(code="FGA0003", name="COMPILADORES 1", unit_id=673),
                Subject(code="CIC0004", name="ALGORITMOS"),
            ]
        )
        session.flush()
        compiladores = Classroom(subject_code="FGA0003", number="01", semester="2026.2")
        session.add_all(
            [
                compiladores,
                Classroom(subject_code="FGA0003", number="02", semester="2026.2"),
                Classroom(subject_code="CIC0004", number="01", semester="2026.2"),
                Classroom(subject_code="CIC0004", number="01", semester="2027.1"),
            ]
        )
        professor = Professor(name="FABIO MENDES")
        session.add(professor)
        session.flush()
        session.add(
            ClassroomProfessor(classroom_id=compiladores.id, professor_id=professor.id)
        )


@pytest.fixture
def logado(client, cookies):
    client.cookies.update(cookies(refresh=CREDENCIAIS))
    return client


def test_grupos_tem_leitura_publica_e_escrita_autenticada(client, turmas):
    assert client.get(TURMA).status_code == 200
    assert client.put(TURMA, json={"groups": []}).status_code == 401
    assert client.get("/groups", params={"semester": "2026.2"}).status_code == 200


def test_turma_sem_grupos_e_cadastro_de_ate_tres_grupos(logado, turmas, database):
    vazio = logado.get(TURMA)
    assert vazio.status_code == 200
    assert vazio.headers["cache-control"] == "no-store"
    assert vazio.json() == {
        "classroom": {
            "code": "FGA0003",
            "name": "COMPILADORES 1",
            "number": "01",
            "semester": "2026.2",
        },
        "groups": [],
    }

    grupos = [
        {"platform": "whatsapp", "url": WHATSAPP, "password": "ignorada"},
        {"platform": "telegram", "url": "https://t.me/+compiladores"},
        {
            "platform": "aprender3",
            "url": "https://aprender3.unb.br/course/view.php?id=1",
            "password": " chave123 ",
        },
    ]
    response = logado.put("/groups/fga0003/2026.2/01", json={"groups": grupos})
    assert response.status_code == 200
    assert [
        {k: v for k, v in g.items() if k != "id"} for g in response.json()["groups"]
    ] == [
        {"platform": "whatsapp", "url": WHATSAPP, "password": None},
        {"platform": "telegram", "url": "https://t.me/+compiladores", "password": None},
        {
            "platform": "aprender3",
            "url": "https://aprender3.unb.br/course/view.php?id=1",
            "password": "chave123",
        },
    ]
    assert logado.get(TURMA).json() == response.json()

    # nada de quem cadastrou vai para o banco: só a turma e os links
    assert {column.key for column in inspect(ClassroomGroup).columns} == {
        "id",
        "classroom_id",
        "position",
        "platform",
        "url",
        "password",
        "created_at",
        "updated_at",
    }


def test_qualquer_aluno_edita_e_apaga_os_grupos(logado, turmas, cookies):
    logado.put(TURMA, json={"groups": [{"platform": "whatsapp", "url": WHATSAPP}]})

    outro = Credentials(registration="252000000", password=SecretStr("outra"))
    logado.cookies.clear()
    logado.cookies.update(cookies(refresh=outro))
    teams = "https://teams.microsoft.com/l/team/abc"
    editado = logado.put(TURMA, json={"groups": [{"platform": "teams", "url": teams}]})
    assert [group["url"] for group in editado.json()["groups"]] == [teams]

    assert logado.put(TURMA, json={"groups": []}).json()["groups"] == []


@pytest.mark.parametrize(
    "grupo",
    [
        {"platform": "whatsapp", "url": "https://t.me/+errado"},
        {"platform": "whatsapp", "url": "http://chat.whatsapp.com/AbC"},
        {"platform": "telegram", "url": "https://evil.com/t.me"},
        {"platform": "teams", "url": "https://teams.microsoft.com.evil.com/x"},
        {"platform": "discord", "url": "https://discord.gg/x"},
        {"platform": "whatsapp", "url": "https://chat.whatsapp.com/" + "a" * 300},
    ],
)
def test_link_fora_da_plataforma_retorna_422(logado, turmas, grupo):
    assert logado.put(TURMA, json={"groups": [grupo]}).status_code == 422


def test_mais_de_tres_grupos_e_turma_inexistente(logado, turmas):
    grupo = {"platform": "whatsapp", "url": WHATSAPP}
    assert logado.put(TURMA, json={"groups": [grupo] * 4}).status_code == 422
    assert logado.get("/groups/FGA0003/2026.2/09").status_code == 404
    assert (
        logado.put("/groups/XYZ0001/2026.2/01", json={"groups": []}).status_code == 404
    )


def test_lista_turmas_do_semestre_com_busca_campus_e_so_com_grupos(
    logado, turmas, database
):
    logado.put(TURMA, json={"groups": [{"platform": "whatsapp", "url": WHATSAPP}]})

    todas = logado.get("/groups", params={"semester": "2026.2"}).json()
    assert todas["total"] == 3
    assert [
        (item["code"], item["number"], item["groups"]) for item in todas["items"]
    ] == [
        ("CIC0004", "01", 0),
        ("FGA0003", "01", 1),
        ("FGA0003", "02", 0),
    ]
    assert todas["items"][1]["professors"] == ["FABIO MENDES"]

    def codes(**params):
        page = logado.get("/groups", params={"semester": "2026.2", **params}).json()
        return [(item["code"], item["number"]) for item in page["items"]]

    assert codes(campus="gama") == [("FGA0003", "01"), ("FGA0003", "02")]
    assert codes(campus="darcy") == [("CIC0004", "01")]
    assert codes(q="compilador") == [("FGA0003", "01"), ("FGA0003", "02")]
    assert codes(q="cic0004") == [("CIC0004", "01")]
    assert codes(with_groups="true") == [("FGA0003", "01")]
    assert logado.get("/groups", params={"semester": "2026"}).status_code == 422


def test_grupos_somem_com_a_turma(logado, turmas, database):
    logado.put(TURMA, json={"groups": [{"platform": "whatsapp", "url": WHATSAPP}]})
    with database.begin() as session:
        session.delete(
            session.scalar(
                select(Classroom).where(
                    Classroom.subject_code == "FGA0003", Classroom.number == "01"
                )
            )
        )
    with database() as session:
        assert session.scalar(select(ClassroomGroup)) is None
