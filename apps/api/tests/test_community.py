"""Comunidade: conversas, guias, denúncias e o painel do administrador."""

from datetime import datetime
from io import BytesIO
from zoneinfo import ZoneInfo

import pyotp
import pytest
from PIL import Image
from pydantic import SecretStr
from sigaa_client import Credentials
from sqlalchemy import inspect, select, text

from api.core.config import settings
from api.db.models import (
    ForumPost,
    ForumReply,
    Material,
    Professor,
    ProfessorReview,
    Report,
    Subject,
    Tutorial,
)
from api.modules.admin import auth
from api.modules.admin.auth import hash_password

ANA = Credentials(registration="251000000", password=SecretStr("senha123"))
BIA = Credentials(registration="252000000", password=SecretStr("senha456"))
SENHA_ADMIN = "senha-do-admin-de-teste"
HASH_ADMIN = hash_password(SENHA_ADMIN)
# As rotas do painel que mudam algo exigem este header (contra CSRF).
ADMIN = {"X-Admin-Request": "1"}
GUIA = {
    "title": "Como pedir dispensa de estágio",
    "summary": "O que juntar e para quem mandar o pedido de dispensa.",
    "body": "Primeiro confira o regulamento do curso. " * 5,
    "category": "estagio",
}


@pytest.fixture
def base(database):
    with database.begin() as session:
        session.add(Subject(code="FGA0030", name="ESTRUTURAS DE DADOS 2"))
        session.add(Professor(siape=111, name="ANA", unit_id=673))


@pytest.fixture
def painel(monkeypatch):
    monkeypatch.setattr(settings, "admin_username", "admin-teste")
    monkeypatch.setattr(settings, "admin_password_hash", HASH_ADMIN)


def _entrar_admin(client, senha=SENHA_ADMIN):
    response = client.post(
        "/admin/api/login",
        json={"username": "admin-teste", "password": senha},
        headers=ADMIN,
    )
    if response.status_code != 200:
        return response
    if response.json()["stage"] == "enroll":
        secret = client.get("/admin/api/mfa/enroll").json()["secret"]
        response = client.post(
            "/admin/api/mfa/confirm",
            json={"code": pyotp.TOTP(secret).now()},
            headers=ADMIN,
        )
        client._admin_recovery_codes = response.json()["recovery_codes"]
        return response
    return client.post(
        "/admin/api/mfa/verify",
        json={"code": client._admin_recovery_codes.pop()},
        headers=ADMIN,
    )


@pytest.fixture
def ana(client, cookies):
    client.cookies.update(cookies(refresh=ANA))
    return client


# Cada aluno num aparelho: a autoria vem do segredo do aparelho, não da matrícula.
APARELHOS = {"251000000": "a" * 64, "252000000": "b" * 64}


def _como(client, cookies, credentials):
    client.cookies.clear()
    client.cookies.update(cookies(refresh=credentials))
    client.headers["X-Followw-Author"] = APARELHOS[credentials.registration]


def _postar(client, **body):
    response = client.post(
        "/forum",
        json={
            "kind": "duvida",
            "title": "Alguém sabe da P1?",
            "body": "Cai recursão?",
            **body,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_comunidade_leitura_publica_e_publicacao_com_login(client, base):
    assert client.get("/forum").status_code == 200
    assert client.post("/forum", json={}).status_code == 401


def test_conversa_anonima_com_respostas_do_autor_marcadas(ana, base, cookies, database):
    post = _postar(ana, campus="gama", subject="fga0030")
    assert post["mine"] is True
    assert post["subject"] == {"code": "FGA0030", "name": "ESTRUTURAS DE DADOS 2"}

    _como(ana, cookies, BIA)
    resposta = ana.post(f"/forum/{post['id']}/replies", json={"body": "Cai sim."})
    assert resposta.status_code == 201
    _como(ana, cookies, ANA)
    detalhe = ana.post(f"/forum/{post['id']}/replies", json={"body": "Valeu!"}).json()
    assert [(r["body"], r["by_author"], r["mine"]) for r in detalhe["replies"]] == [
        ("Cai sim.", False, False),
        ("Valeu!", True, True),
    ]
    assert detalhe["reply_count"] == 2

    # nada de quem escreveu no banco
    colunas = {c.key for c in inspect(ForumPost).columns} | {
        c.key for c in inspect(ForumReply).columns
    }
    assert not {"user_id", "registration", "author", "name"} & colunas
    with database() as session:
        chaves = session.scalars(select(ForumReply.author_key)).all()
    assert all("251000000" not in chave for chave in chaves)


def test_filtros_ordem_e_busca(ana, base):
    gama = _postar(ana, campus="gama", title="Dúvida do Gama")
    _postar(ana, campus="darcy", kind="post", title="Post do Darcy")
    geral = _postar(ana, title="Sem campus marcado")
    ana.post(f"/forum/{gama['id']}/replies", json={"body": "Resposta"})

    def titles(**params):
        return [
            item["title"] for item in ana.get("/forum", params=params).json()["items"]
        ]

    assert titles() == ["Sem campus marcado", "Post do Darcy", "Dúvida do Gama"]
    # quem não marcou campus aparece para todos
    assert titles(campus="gama") == ["Sem campus marcado", "Dúvida do Gama"]
    assert titles(kind="post") == ["Post do Darcy"]
    assert titles(order="active")[0] == "Dúvida do Gama"
    assert "Dúvida do Gama" not in titles(order="unanswered")
    assert titles(q="darcy") == ["Post do Darcy"]
    assert geral["campus"] is None


def test_filtro_das_minhas_materias(ana, base, database):
    with database.begin() as session:
        session.add(Subject(code="FGA0146", name="ESTRUTURAS DE DADOS 1"))
    _postar(ana, subject="FGA0030", title="Sobre ED2")
    _postar(ana, subject="FGA0146", title="Sobre ED1")
    _postar(ana, title="Sem matéria")

    def titles(**params):
        return [
            item["title"] for item in ana.get("/forum", params=params).json()["items"]
        ]

    assert titles(subjects=["fga0030", "FGA0146"]) == ["Sobre ED1", "Sobre ED2"]
    assert titles(subjects=["FGA0030"]) == ["Sobre ED2"]
    assert ana.get("/forum", params={"subjects": ["x;drop"]}).status_code == 422


def test_conteudo_fica_cifrado_no_banco(ana, base, database):
    post = _postar(ana, title="Segredo do título", body="Texto que ninguém lê no banco")
    ana.post(f"/forum/{post['id']}/replies", json={"body": "Resposta secreta"})
    with database() as session:
        bruto = session.execute(
            text(
                "SELECT title, body FROM forum_posts UNION ALL SELECT body, body FROM forum_replies"
            )
        ).all()
    assert all(valor.startswith("v2:") for linha in bruto for valor in linha)
    assert "Segredo" not in str(bruto) and "secreta" not in str(bruto)
    # A API devolve o texto normal, e a busca funciona com o conteúdo cifrado.
    assert ana.get(f"/forum/{post['id']}").json()["title"] == "Segredo do título"
    assert ana.get("/forum", params={"q": "ninguem"}).json()["total"] == 1


def test_so_o_autor_apaga(ana, base, cookies):
    post = _postar(ana)
    reply = ana.post(f"/forum/{post['id']}/replies", json={"body": "oi"}).json()[
        "replies"
    ][0]
    _como(ana, cookies, BIA)
    assert ana.delete(f"/forum/{post['id']}").status_code == 404
    assert ana.delete(f"/forum/{post['id']}/replies/{reply['id']}").status_code == 404
    _como(ana, cookies, ANA)
    assert ana.delete(f"/forum/{post['id']}/replies/{reply['id']}").status_code == 204
    assert ana.get(f"/forum/{post['id']}").json()["reply_count"] == 0
    assert ana.delete(f"/forum/{post['id']}").status_code == 204
    assert ana.get(f"/forum/{post['id']}").status_code == 404


@pytest.mark.parametrize(
    "body",
    [
        {"kind": "duvida", "title": "oi", "body": "x"},
        {"kind": "meme", "title": "Título bom", "body": "x"},
        {"kind": "duvida", "title": "Título bom", "body": ""},
        {"kind": "duvida", "title": "Título bom", "body": "x" * 4001},
        {"kind": "duvida", "title": "Título bom", "body": "x", "campus": "lua"},
        {"kind": "duvida", "title": "Título bom", "body": "x", "subject": "XYZ0001"},
    ],
)
def test_publicacao_invalida(ana, base, body):
    assert ana.post("/forum", json=body).status_code == 422


def test_guia_so_aparece_depois_de_aprovado(ana, base, painel):
    _entrar_admin(ana)
    enviado = ana.post("/tutorials", json=GUIA)
    assert enviado.status_code == 201
    guia_id = enviado.json()["id"]
    assert ana.get("/tutorials").json() == []
    assert ana.get(f"/tutorials/{guia_id}").status_code == 404

    pendentes = ana.get("/admin/api/tutorials", headers=ADMIN).json()
    assert [item["title"] for item in pendentes] == [GUIA["title"]]
    aprovar = ana.post(
        f"/admin/api/tutorials/{guia_id}", json={"action": "accept"}, headers=ADMIN
    )
    assert aprovar.status_code == 204

    publicado = ana.get("/tutorials", params={"category": "estagio"}).json()
    assert [item["title"] for item in publicado] == [GUIA["title"]]
    assert ana.get(f"/tutorials/{guia_id}").json()["body"].startswith("Primeiro")
    assert ana.get("/tutorials", params={"q": "dispensa"}).json()[0]["id"] == guia_id
    assert ana.get("/tutorials", params={"category": "sigaa"}).json() == []


def test_guias_pendentes_tem_limite_e_exigem_login(client, ana, base):
    for _ in range(3):
        assert ana.post("/tutorials", json=GUIA).status_code == 201
    assert ana.post("/tutorials", json=GUIA).status_code == 409
    ana.cookies.clear()
    assert ana.post("/tutorials", json=GUIA).status_code == 401
    assert ana.post("/tutorials", json={**GUIA, "body": "curto"}).status_code in (
        401,
        422,
    )


def test_denuncia_sem_login_e_moderacao_apaga(client, base, database, painel, cookies):
    client.cookies.update(cookies(refresh=ANA))
    review = client.post(
        "/reviews", json={"siape": 111, "rating": 10, "comment": "Ruim"}
    )
    review_id = review.json()["review"]["id"]
    client.cookies.clear()

    # o próprio docente, sem conta, pede a exclusão
    pedido = client.post(
        "/reports",
        json={
            "target_type": "review",
            "target_id": review_id,
            "reason": "ofensivo",
            "message": "Sou o docente.",
        },
    )
    assert pedido.status_code == 201
    assert (
        client.post(
            "/reports",
            json={"target_type": "review", "target_id": review_id, "reason": "nada"},
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/reports",
            json={
                "target_type": "post",
                "target_id": review_id,
                "reason": "spam",
            },
        ).status_code
        == 404
    )

    assert client.get("/admin/api/reports").status_code == 401
    _entrar_admin(client)
    fila = client.get("/admin/api/reports", headers=ADMIN).json()
    assert fila[0]["preview"] == "Nota 10: Ruim"
    assert fila[0]["message"] == "Sou o docente."
    decide = client.post(
        f"/admin/api/reports/{fila[0]['id']}", json={"action": "accept"}, headers=ADMIN
    )
    assert decide.status_code == 204
    with database() as session:
        assert session.get(ProfessorReview, review_id) is None
        assert session.scalar(select(Report.status)) == "accepted"
    assert client.get("/admin/api/reports", headers=ADMIN).json() == []


def test_denuncia_recusada_mantem_o_conteudo(ana, base, painel, database):
    _entrar_admin(ana)
    post = _postar(ana)
    report = ana.post(
        "/reports",
        json={"target_type": "post", "target_id": post["id"], "reason": "spam"},
    ).json()
    ana.post(
        f"/admin/api/reports/{report['id']}", json={"action": "reject"}, headers=ADMIN
    )
    assert ana.get(f"/forum/{post['id']}").status_code == 200
    rejeitadas = ana.get("/admin/api/reports?status=rejected", headers=ADMIN).json()
    assert [item["id"] for item in rejeitadas] == [report["id"]]


def test_painel_desligado_sem_usuario_e_senha(client, base, monkeypatch):
    monkeypatch.setattr(settings, "admin_username", None)
    monkeypatch.setattr(settings, "admin_password_hash", None)
    assert client.get("/admin").status_code == 200
    assert client.get("/admin/api/session").json() == {
        "enabled": False,
        "user": None,
        "setup": False,
    }
    assert client.get("/admin/api/overview").status_code == 401
    assert _entrar_admin(client).status_code == 401
    # fora do OpenAPI do app
    assert "/admin" not in str(client.get("/openapi.json").json()["paths"])


def test_login_do_painel_com_sessao_em_cookie_seguro(client, base, painel, ler_cookies):
    assert client.get("/admin/api/overview").status_code == 401
    assert _entrar_admin(client, "senha-errada").status_code == 401
    # sem o header próprio, nem o login passa (um site de fora não consegue mandá-lo)
    sem_header = client.post(
        "/admin/api/login", json={"username": "admin-teste", "password": SENHA_ADMIN}
    )
    assert sem_header.status_code == 403

    resposta = _entrar_admin(client)
    assert resposta.status_code == 200
    cookie = ler_cookies(resposta)[auth.ADMIN_COOKIE]
    assert cookie["httponly"] and cookie["samesite"].lower() == "strict"
    assert SENHA_ADMIN not in cookie.value
    profile = client.get("/admin/api/session").json()
    assert profile["enabled"] is True and profile["setup"] is False
    assert profile["user"]["username"] == "admin-teste"
    assert profile["user"]["role"] == "owner"
    assert client.get("/admin/api/overview").status_code == 200
    # mudar algo sem o header é recusado mesmo com a sessão
    assert client.post("/admin/api/maintenance").status_code == 403
    assert client.post("/admin/api/maintenance", headers=ADMIN).status_code == 200

    client.post("/admin/api/logout", headers=ADMIN)
    client.cookies.delete(auth.ADMIN_COOKIE)
    assert client.get("/admin/api/overview").status_code == 401


def test_login_do_painel_bloqueia_depois_de_muitas_tentativas(client, base, painel):
    for _ in range(5):
        assert _entrar_admin(client, "chute").status_code == 401
    # nem a senha certa entra durante o bloqueio
    assert _entrar_admin(client).status_code == 429


def test_hash_da_senha_nao_guarda_a_senha():
    guardado = hash_password("uma-senha-bem-longa")
    assert guardado.startswith("$argon2id$") and "uma-senha" not in guardado
    assert auth.verify_password("uma-senha-bem-longa", guardado)
    assert not auth.verify_password("outra-senha-qualquer", guardado)
    assert not auth.verify_password("x", "lixo")


def test_painel_mostra_uso_recursos_e_apaga_conteudo(
    ana, base, painel, monkeypatch, tmp_path
):
    monkeypatch.setattr(settings, "materials_dir", str(tmp_path))
    _entrar_admin(ana)
    post = _postar(ana)
    image = BytesIO()
    Image.new("RGB", (10, 10), (1, 2, 3)).save(image, format="PNG")
    material = ana.post(
        "/materials/FGA0030",
        files={"file": ("a.png", image.getvalue())},
        data={"title": "Prova 1", "kind": "prova", "semester": "2026.2"},
    ).json()
    # o arquivo fica cifrado no disco
    [arquivo] = [f for f in tmp_path.rglob("*") if f.is_file()]
    assert not arquivo.read_bytes().startswith(b"\x89PNG")
    assert ana.get(f"/admin/api/materials/{material['id']}/file").content.startswith(
        b"\x89PNG"
    )

    overview = ana.get("/admin/api/overview").json()
    assert overview["counts"]["publicações"] == 1
    assert overview["counts"]["materiais"] == 1
    assert overview["materials_bytes"] > 0
    assert overview["process"]["memory_bytes"] > 0
    assert overview["database_bytes"] > 0
    assert set(overview["users"]) == {"hoje", "esta semana", "este mês"}

    pagina = ana.get("/admin/api/content/material").json()
    assert pagina["total"] == 1 and pagina["items"][0]["id"] == material["id"]
    assert (
        ana.get("/admin/api/content/material", params={"q": "prova"}).json()["total"]
        == 1
    )
    detalhe = ana.get(f"/admin/api/content/material/{material['id']}").json()
    assert detalhe["title"] == "Prova 1"
    assert not {"uploader_key", "storage_key", "sha256"} & set(detalhe)

    apagar = ana.request(
        "DELETE",
        f"/admin/api/content/material/{material['id']}",
        json={"reason": "teste"},
        headers=ADMIN,
    )
    assert apagar.status_code == 204
    assert not [f for f in tmp_path.rglob("*") if f.is_file()]
    assert (
        ana.delete(f"/admin/api/content/post/{post['id']}", headers=ADMIN).status_code
        == 204
    )
    assert (
        ana.delete(f"/admin/api/content/post/{post['id']}", headers=ADMIN).status_code
        == 404
    )
    registro = ana.get("/admin/api/log").json()
    assert [entrada["action"] for entrada in registro][:2] == ["delete", "delete"]
    assert registro[1]["detail"] == "teste"


def test_estatisticas_de_uso_por_periodo(ana, base, painel, sigaa, hoje, database):
    from api.db.models import SystemFlag

    with database.begin() as session:
        session.add(SystemFlag(key="telemetry", enabled=True))
    ana.headers["X-Followw-Metrics"] = "1"
    # O conteúdo nasce com a data real: o "hoje" do painel precisa ser o mesmo.
    hoje(datetime.now(ZoneInfo("America/Sao_Paulo")).replace(tzinfo=None))
    ana.cookies.clear()
    ana.post("/auth/sigaa", json={"registration": "251000000", "password": "senha123"})
    _entrar_admin(ana)
    _postar(ana)
    serie = ana.get("/admin/api/series", params={"days": 7}).json()
    assert len(serie["days"]) == 7
    assert serie["series"]["alunos ativos"][-1] == 1
    assert serie["series"]["publicações"][-1] == 1
    assert serie["weeks"][-1]["users"] == 1 and serie["months"][-1]["users"] == 1
    assert ana.get("/admin/api/series", params={"days": 3}).status_code == 422
    distribuicao = ana.get("/admin/api/breakdown").json()
    assert distribuicao["posts_by_kind"] == {"duvida": 1}


def test_funcao_desligada_pelo_painel_responde_503(ana, base, painel):
    _entrar_admin(ana)
    flags = ana.put("/admin/api/flags/forum", json={"enabled": False}, headers=ADMIN)
    assert flags.json()["forum"] is False
    novo = ana.post(
        "/forum", json={"kind": "duvida", "title": "Título bom", "body": "x"}
    )
    assert novo.status_code == 503
    assert "moderação" in novo.json()["detail"]
    # ler continua valendo
    assert ana.get("/forum").status_code == 200
    ana.put("/admin/api/flags/forum", json={"enabled": True}, headers=ADMIN)
    _postar(ana)
    assert (
        ana.put(
            "/admin/api/flags/nada", json={"enabled": True}, headers=ADMIN
        ).status_code
        == 404
    )


def test_admin_edita_guia(ana, base, painel):
    _entrar_admin(ana)
    guia = ana.post("/tutorials", json=GUIA).json()
    novo = {**GUIA, "title": "Dispensa de estágio, passo a passo"}
    assert (
        ana.put(
            f"/admin/api/tutorials/{guia['id']}", json=novo, headers=ADMIN
        ).status_code
        == 204
    )
    pendentes = ana.get("/admin/api/tutorials").json()
    assert pendentes[0]["title"] == "Dispensa de estágio, passo a passo"
    assert (
        ana.put(
            f"/admin/api/tutorials/{guia['id']}",
            json={**GUIA, "body": "x"},
            headers=ADMIN,
        ).status_code
        == 422
    )


def test_autoria_nao_depende_da_matricula(ana, base, cookies):
    post = _postar(ana)
    # a mesma matrícula noutro aparelho não é reconhecida como autora
    ana.headers["X-Followw-Author"] = "c" * 64
    assert ana.get(f"/forum/{post['id']}").json()["mine"] is False
    assert ana.delete(f"/forum/{post['id']}").status_code == 404
    # sem o segredo do aparelho não dá para publicar
    del ana.headers["X-Followw-Author"]
    assert (
        ana.post(
            "/forum", json={"kind": "duvida", "title": "Título bom", "body": "x"}
        ).status_code
        == 400
    )
    ana.headers["X-Followw-Author"] = "nao-hex"
    assert (
        ana.post(
            "/forum", json={"kind": "duvida", "title": "Título bom", "body": "x"}
        ).status_code
        == 400
    )


def test_modelos_da_comunidade_nao_guardam_quem_escreveu():
    for model in (ForumPost, ForumReply, Material, Tutorial, Report):
        columns = {column.key for column in inspect(model).columns}
        assert not {"user_id", "registration", "name", "email", "author"} & columns


def test_admin_esconde_cartoes_do_mais_e_define_links(client, base, painel):
    config = client.get("/public/config").json()
    assert config["menu"]["automatricula"] is True
    assert config["menu"]["monitor"] is True
    assert config["links"]["automatricula"].startswith("https://github.com/")
    assert config["links"]["monitor"] is None

    _entrar_admin(client)
    assert (
        client.put(
            "/admin/api/menu/automatricula", json={"visible": False}, headers=ADMIN
        ).status_code
        == 200
    )
    client.put("/admin/api/menu/monitor", json={"visible": False}, headers=ADMIN)
    salvo = client.put(
        "/admin/api/texts/monitor_url",
        json={"value": "https://t.me/monitor_vagas_bot"},
        headers=ADMIN,
    )
    assert salvo.json()["monitor_url"] == "https://t.me/monitor_vagas_bot"
    # só https, sem script
    for ruim in ("javascript:alert(1)", "http://t.me/x", "https://t.me/a b"):
        assert (
            client.put(
                "/admin/api/texts/monitor_url", json={"value": ruim}, headers=ADMIN
            ).status_code
            == 422
        )
    assert (
        client.put(
            "/admin/api/menu/nada", json={"visible": True}, headers=ADMIN
        ).status_code
        == 404
    )

    client.cookies.clear()
    config = client.get("/public/config").json()
    assert (config["menu"]["automatricula"], config["menu"]["monitor"]) == (
        False,
        False,
    )
    assert config["links"]["monitor"] == "https://t.me/monitor_vagas_bot"


def test_primeiro_acesso_do_admin_pela_pagina_so_local(
    client, base, monkeypatch, tmp_path
):
    from api.modules.admin import cli

    monkeypatch.setattr(settings, "admin_username", None)
    monkeypatch.setattr(settings, "admin_password_hash", None)
    env = tmp_path / ".env"
    monkeypatch.setattr(cli, "ENV_FILE", env)
    monkeypatch.setattr(auth, "_client", lambda request: "127.0.0.1")
    assert client.get("/admin/api/session").json()["setup"] is True
    curta = {"username": "admin-teste", "password": "curta"}
    assert client.post("/admin/api/setup", json=curta, headers=ADMIN).status_code == 422
    corpo = {"username": "admin-teste", "password": "uma-senha-bem-longa"}
    assert client.post("/admin/api/setup", json=corpo).status_code == 403
    assert client.post("/admin/api/setup", json=corpo, headers=ADMIN).status_code == 200
    assert client.get("/admin/api/overview").status_code == 401
    secret = client.get("/admin/api/mfa/enroll").json()["secret"]
    assert (
        client.post(
            "/admin/api/mfa/confirm",
            json={"code": pyotp.TOTP(secret).now()},
            headers=ADMIN,
        ).status_code
        == 200
    )
    assert client.get("/admin/api/overview").status_code == 200
    assert not env.exists()
    assert client.post("/admin/api/setup", json=corpo, headers=ADMIN).status_code == 409


def test_cadastro_do_admin_recusado_fora_do_pc(client, base, monkeypatch):
    monkeypatch.setattr(settings, "admin_username", None)
    monkeypatch.setattr(settings, "admin_password_hash", None)
    monkeypatch.setattr(auth, "_client", lambda request: "203.0.113.9")
    corpo = {"username": "admin-teste", "password": "uma-senha-bem-longa"}
    assert client.post("/admin/api/setup", json=corpo, headers=ADMIN).status_code == 403


def test_versao_do_conteudo_muda_so_na_parte_alterada(ana, base):
    antes = ana.get("/public/config/version").json()["parts"]
    _postar(ana)
    depois = ana.get("/public/config/version").json()["parts"]
    assert antes["forum"] != depois["forum"]
    assert antes["reviews"] == depois["reviews"]


def test_painel_mostra_armazenamento_real_sem_estimar_dados_do_aluno(
    client, base, painel
):
    _entrar_admin(client)
    overview = client.get("/admin/api/overview").json()
    assert "device" not in overview
    assert overview["database_bytes"] > 0


def test_visitante_le_conversa_e_respostas_mas_nao_pode_interagir(ana, base):
    post = _postar(ana)
    reply = ana.post(
        f"/forum/{post['id']}/replies", json={"body": "Resposta pública"}
    ).json()["replies"][0]
    ana.cookies.clear()
    assert ana.get("/forum").json()["total"] == 1
    assert (
        ana.get(f"/forum/{post['id']}").json()["replies"][0]["body"]
        == "Resposta pública"
    )
    assert (
        ana.post(f"/forum/{post['id']}/replies", json={"body": "Tentativa"}).status_code
        == 401
    )
    assert ana.delete(f"/forum/{post['id']}").status_code == 401
    assert ana.delete(f"/forum/{post['id']}/replies/{reply['id']}").status_code == 401


def test_trocar_senha_invalida_sessao_admin_existente(client, painel, database):
    from api.modules.admin.models import AdminAccount

    assert _entrar_admin(client).status_code == 200
    with database.begin() as session:
        account = session.scalar(select(AdminAccount))
        account.password_hash = hash_password("outra-senha-do-admin")
        account.session_version += 1
    assert client.get("/admin/api/overview").status_code == 401


def test_recuperacao_local_remove_so_credenciais_admin(tmp_path):
    from api.modules.admin.cli import reset_credentials

    env = tmp_path / ".env"
    env.write_text(
        "JWT_SECRET_KEY=preservar\nADMIN_USERNAME=admin\nADMIN_PASSWORD_HASH='hash'\nDATA_ENCRYPTION_KEY=preservar-tambem\n",
        encoding="utf-8",
    )
    reset_credentials(env)
    assert (
        env.read_text(encoding="utf-8")
        == "JWT_SECRET_KEY=preservar\nDATA_ENCRYPTION_KEY=preservar-tambem\n"
    )


def test_primeiro_cadastro_nao_sobrescreve_hash_ja_gravado(tmp_path):
    from api.modules.admin.cli import write_credentials

    env = tmp_path / ".env"
    write_credentials("primeiro", HASH_ADMIN, env, first_setup=True)
    saved = env.read_text(encoding="utf-8")
    with pytest.raises(FileExistsError):
        write_credentials("segundo", HASH_ADMIN, env, first_setup=True)
    assert env.read_text(encoding="utf-8") == saved


def test_ip_local_mapeado_em_ipv6_permite_primeiro_cadastro(monkeypatch):
    from starlette.requests import Request

    monkeypatch.setattr(settings, "admin_username", None)
    monkeypatch.setattr(settings, "admin_password_hash", None)
    request = Request({"type": "http", "client": ("::ffff:127.0.0.1", 1234)})
    assert auth.can_setup(request)
    monkeypatch.setattr(settings, "environment", "production")
    assert not auth.can_setup(request)
