"""Demonstração pelo painel: só o Owner, só fora de produção, e nunca apaga o que é real."""

import importlib.util
import pathlib

import pytest
from sqlalchemy import func, select

from api.core.config import settings
from api.db.models import (
    AdminLog,
    Classroom,
    ClassroomGroup,
    ClassroomProfessor,
    DemoRecord,
    ForumPost,
    Professor,
    ProfessorReview,
    Subject,
)

_spec = importlib.util.spec_from_file_location(
    "admin_security_fixtures",
    pathlib.Path(__file__).with_name("test_admin_security.py"),
)
_fixtures = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_fixtures)
HEADERS, owner, roles = _fixtures.HEADERS, _fixtures.owner, _fixtures.roles

REAL_URL = "https://chat.whatsapp.com/Real"


def como(client, cookies):
    client.cookies.clear()
    client.cookies.update(cookies)


@pytest.fixture
def catalogo(database, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "demo_data", True)
    monkeypatch.setattr(settings, "materials_dir", str(tmp_path))
    with database.begin() as session:
        session.add_all(
            [Subject(code="FGA0030", name="ED2"), Subject(code="FGA0003", name="C1")]
        )
        professor = Professor(siape=111, name="MAURICIO SERRANO", unit_id=673)
        atual = Classroom(subject_code="FGA0030", number="02", semester="2026.2")
        outra = Classroom(subject_code="FGA0003", number="01", semester="2026.2")
        session.add_all([professor, atual, outra])
        session.flush()
        session.add(
            ClassroomProfessor(classroom_id=atual.id, professor_id=professor.id)
        )
        session.add(
            ClassroomGroup(
                classroom_id=outra.id, position=0, platform="whatsapp", url=REAL_URL
            )
        )
        # conteúdo real que a demonstração jamais pode tocar
        session.add(
            ProfessorReview(
                professor_id=professor.id,
                subject_code="FGA0030",
                rating=80,
                token_hash="real",
            )
        )
        session.add(
            ForumPost(kind="post", title="Real", body="texto real", author_key="a" * 64)
        )


def contar(database, modelo):
    with database() as sessao:
        return sessao.scalar(select(func.count()).select_from(modelo))


@pytest.mark.parametrize(
    ("cargo", "esperado"),
    [("moderator", 403), ("administrator", 403), ("owner", 200)],
)
def test_so_o_owner_acessa(roles, catalogo, cargo, esperado):
    client, cookies, _ = roles
    como(client, cookies[cargo])
    assert client.get("/admin/api/demo", headers=HEADERS).status_code == esperado
    assert client.post("/admin/api/demo/load", headers=HEADERS).status_code in {
        esperado,
        404,
    }
    assert client.delete("/admin/api/demo", headers=HEADERS).status_code in {
        esperado,
        404,
    }


def test_sem_sessao_nao_acessa(roles, catalogo):
    client, _, _ = roles
    client.cookies.clear()
    assert client.get("/admin/api/demo", headers=HEADERS).status_code in {401, 403}
    assert client.post("/admin/api/demo/load", headers=HEADERS).status_code in {
        401,
        403,
    }


def test_desligado_ou_em_producao_nada_carrega(roles, catalogo, monkeypatch, database):
    client, cookies, _ = roles
    como(client, cookies["owner"])
    monkeypatch.setattr(settings, "demo_data", False)
    visao = client.get("/admin/api/demo", headers=HEADERS).json()
    assert visao["available"] is False and "DEMO_DATA" in visao["reason"]
    assert client.post("/admin/api/demo/load", headers=HEADERS).status_code == 404
    monkeypatch.setattr(settings, "demo_data", True)
    monkeypatch.setattr(settings, "environment", "production")
    assert client.get("/admin/api/demo", headers=HEADERS).json()["available"] is False
    assert client.post("/admin/api/demo/load", headers=HEADERS).status_code == 404
    assert client.delete("/admin/api/demo", headers=HEADERS).status_code == 404
    assert contar(database, DemoRecord) == 0


def test_carregar_marca_tudo_e_limpar_preserva_o_real(roles, catalogo, database):
    client, cookies, _ = roles
    como(client, cookies["owner"])
    antes = {
        m: contar(database, m)
        for m in (ProfessorReview, ForumPost, ClassroomGroup, Classroom, Subject)
    }
    carregado = client.post("/admin/api/demo/load", headers=HEADERS)
    assert carregado.status_code == 200, carregado.text
    status = carregado.json()["status"]
    assert status["loaded"] is True and status["groups"] >= 1 and status["posts"] >= 1
    assert contar(database, DemoRecord) > 0
    assert contar(database, ProfessorReview) > antes[ProfessorReview]
    # carregar de novo não duplica
    assert (
        client.post("/admin/api/demo/load", headers=HEADERS).json()["status"] == status
    )

    limpo = client.delete("/admin/api/demo", headers=HEADERS).json()["status"]
    assert limpo["loaded"] is False
    assert contar(database, DemoRecord) == 0
    depois = {m: contar(database, m) for m in antes}
    assert depois == antes
    with database() as sessao:
        assert sessao.scalars(select(ClassroomGroup.url)).all() == [REAL_URL]
        assert sessao.scalar(select(ProfessorReview.token_hash)) == "real"
        assert sessao.scalar(select(ForumPost.title)) == "Real"


def test_acoes_ficam_na_auditoria(roles, catalogo, database):
    client, cookies, _ = roles
    como(client, cookies["owner"])
    client.post("/admin/api/demo/load", headers=HEADERS)
    client.delete("/admin/api/demo", headers=HEADERS)
    with database() as sessao:
        acoes = set(sessao.scalars(select(AdminLog.action)))
    assert {"demo.load", "demo.clear"} <= acoes


def test_catalogo_vazio_e_recusado_sem_criar_nada(roles, monkeypatch, database):
    client, cookies, _ = roles
    como(client, cookies["owner"])
    monkeypatch.setattr(settings, "demo_data", True)
    assert client.post("/admin/api/demo/load", headers=HEADERS).status_code == 409
    assert contar(database, DemoRecord) == 0


def test_interface_e_servida(roles, catalogo):
    client, _, _ = roles
    client.cookies.clear()
    assert "demoView" in client.get("/admin/assets/dashboard-demo.js").text
