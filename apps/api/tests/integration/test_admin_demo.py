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
    monkeypatch.setattr(settings, "public_url", "http://127.0.0.1:8000")
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
    assert client.request(
        "DELETE",
        "/admin/api/demo",
        headers=HEADERS,
        json={"confirmation": "LIMPAR DEMONSTRAÇÃO"},
    ).status_code in {
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
    assert visao["available"] is True and visao["enabled"] is False
    assert client.post("/admin/api/demo/load", headers=HEADERS).status_code == 409
    monkeypatch.setattr(settings, "demo_data", True)
    monkeypatch.setattr(settings, "environment", "production")
    assert client.get("/admin/api/demo", headers=HEADERS).json()["available"] is False
    assert client.post("/admin/api/demo/load", headers=HEADERS).status_code == 404
    assert (
        client.request(
            "DELETE",
            "/admin/api/demo",
            headers=HEADERS,
            json={"confirmation": "LIMPAR DEMONSTRAÇÃO"},
        ).status_code
        == 404
    )
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

    limpo = client.request(
        "DELETE",
        "/admin/api/demo",
        headers=HEADERS,
        json={"confirmation": "LIMPAR DEMONSTRAÇÃO"},
    ).json()["status"]
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
    client.request(
        "DELETE",
        "/admin/api/demo",
        headers=HEADERS,
        json={"confirmation": "LIMPAR DEMONSTRAÇÃO"},
    )
    with database() as sessao:
        acoes = set(sessao.scalars(select(AdminLog.action)))
    assert {"demo.load", "demo.clear"} <= acoes


def test_catalogo_vazio_e_recusado_sem_criar_nada(roles, monkeypatch, database):
    client, cookies, _ = roles
    como(client, cookies["owner"])
    monkeypatch.setattr(settings, "demo_data", True)
    monkeypatch.setattr(settings, "public_url", "http://127.0.0.1:8000")
    assert client.post("/admin/api/demo/load", headers=HEADERS).status_code == 409
    assert contar(database, DemoRecord) == 0


def test_interface_e_servida(roles, catalogo):
    client, _, _ = roles
    client.cookies.clear()
    assert "demoView" in client.get("/admin/assets/dashboard-demo.js").text


def test_limpeza_preserva_grupo_real_adicionado_a_turma_sintetica(
    roles, catalogo, database
):
    client, cookies, _ = roles
    como(client, cookies["owner"])
    assert client.post("/admin/api/demo/load", headers=HEADERS).status_code == 200
    with database.begin() as session:
        classroom_id = session.scalar(
            select(DemoRecord.record_id).where(DemoRecord.kind == "classroom").limit(1)
        )
        group = ClassroomGroup(
            classroom_id=classroom_id, position=0, platform="whatsapp", url=REAL_URL
        )
        session.add(group)
        session.flush()
        identifier = group.id
    response = client.request(
        "DELETE",
        "/admin/api/demo",
        headers=HEADERS,
        json={"confirmation": "LIMPAR DEMONSTRAÇÃO"},
    )
    assert response.status_code == 409
    with database() as session:
        assert session.get(ClassroomGroup, identifier).url == REAL_URL


def test_previa_e_recarga_transacional_preservam_conteudo_real(
    roles, catalogo, database
):
    client, cookies, _ = roles
    como(client, cookies["owner"])
    preview = client.get("/admin/api/demo/preview", headers=HEADERS)
    assert preview.status_code == 200 and preview.json()["eligible_classrooms"] == 2
    original = contar(database, ForumPost)
    first = client.post("/admin/api/demo/load", headers=HEADERS).json()["status"]
    assert (
        client.post(
            "/admin/api/demo/reload", headers=HEADERS, json={"confirmation": "errado"}
        ).status_code
        == 422
    )
    next_view = client.post(
        "/admin/api/demo/reload",
        headers=HEADERS,
        json={"confirmation": "RECARREGAR DEMONSTRAÇÃO"},
    )
    assert next_view.status_code == 200, next_view.text
    assert next_view.json()["status"]["posts"] == first["posts"]
    assert contar(database, ForumPost) == original + first["posts"]


def test_falha_de_carga_reverte_banco_e_remove_so_arquivos_novos(
    roles, catalogo, monkeypatch, database, tmp_path
):
    from api.modules.admin import demo

    client, cookies, _ = roles
    como(client, cookies["owner"])
    original = demo._load

    async def falhar(session, *args):
        await original(session, *args)
        raise RuntimeError("Falha sintetica depois da carga")

    monkeypatch.setattr(demo, "_load", falhar)
    with pytest.raises(RuntimeError, match="Falha sintetica"):
        client.post("/admin/api/demo/load", headers=HEADERS)
    assert contar(database, DemoRecord) == 0
    assert not [file for file in tmp_path.rglob("*") if file.is_file()]


def test_owner_ativa_sem_editar_env_e_desativa_sem_apagar(roles, catalogo, monkeypatch):
    client, cookies, _ = roles
    como(client, cookies["owner"])
    monkeypatch.setattr(settings, "demo_data", False)
    monkeypatch.setattr(settings, "public_url", "http://127.0.0.1:8000")
    view = client.get("/admin/api/demo", headers=HEADERS).json()
    assert view["available"] is True
    assert view["enabled"] is False
    assert client.post("/admin/api/demo/load", headers=HEADERS).status_code == 409
    response = client.put(
        "/admin/api/demo/settings", json={"enabled": True}, headers=HEADERS
    )
    assert response.status_code == 200, response.text
    assert response.json()["enabled"] is True
    loaded = client.post("/admin/api/demo/load", headers=HEADERS)
    assert loaded.status_code == 200, loaded.text
    response = client.put(
        "/admin/api/demo/settings", json={"enabled": False}, headers=HEADERS
    )
    assert response.json()["enabled"] is False
    assert response.json()["status"] == loaded.json()["status"]


def test_ativacao_por_http_nao_libera_producao_ou_origem_remota(
    roles, catalogo, monkeypatch
):
    client, cookies, _ = roles
    como(client, cookies["owner"])
    for environment, public_url in (
        ("production", "http://127.0.0.1:8000"),
        ("development", "https://followw.app"),
    ):
        monkeypatch.setattr(settings, "environment", environment)
        monkeypatch.setattr(settings, "public_url", public_url)
        assert (
            client.put(
                "/admin/api/demo/settings", json={"enabled": True}, headers=HEADERS
            ).status_code
            == 404
        )
