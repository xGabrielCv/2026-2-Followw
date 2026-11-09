from uuid import uuid4

import pyotp
import pytest
from sqlalchemy import select, text

from api.core.config import settings
from api.modules.admin.models import AdminAccount

HEADERS = {"X-Admin-Request": "1"}
PASSWORD = "senha-administrativa-sintetica"


def test_atualizacao_aditiva_preserva_log_legado_e_e_idempotente(database, postgres):
    from api.crypto import decrypt
    from api.db.main import create_schema

    id_ = uuid4()
    with postgres.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO admin_log(id, action, detail) VALUES (:id, 'legacy', 'Motivo sintético antigo')"
            ),
            {"id": id_},
        )
        create_schema(connection)
        first = connection.execute(
            text("SELECT detail FROM admin_log WHERE id=:id"), {"id": id_}
        ).scalar_one()
        assert first.startswith("v2:")
        assert decrypt(first, "admin.log.detail") == "Motivo sintético antigo"
        create_schema(connection)
        assert (
            connection.execute(
                text("SELECT detail FROM admin_log WHERE id=:id"), {"id": id_}
            ).scalar_one()
            == first
        )


def test_todas_rotas_privilegiadas_recusam_acesso_sem_sessao_mfa(client):
    from fastapi.routing import APIRoute

    from api.modules.admin.router import api

    checked = 0
    for route in api.routes:
        if not isinstance(route, APIRoute):
            continue
        path = route.path
        for name in route.param_convertors:
            replacement = (
                "post" if name == "kind" else "forum" if name == "key" else str(uuid4())
            )
            path = path.replace("{" + name + "}", replacement)
        for method in route.methods:
            checked += 1
            response = client.request(
                method, "/admin/api" + path, json={}, headers=HEADERS
            )
            assert response.status_code == 401, (method, path, response.text)
    assert checked >= 25


def enroll(client):
    enrollment = client.get("/admin/api/mfa/enroll")
    assert enrollment.status_code == 200
    secret = enrollment.json()["secret"]
    response = client.post(
        "/admin/api/mfa/confirm",
        json={"code": pyotp.TOTP(secret).now()},
        headers=HEADERS,
    )
    assert response.status_code == 200, response.text
    return secret, response.json()["recovery_codes"]


@pytest.fixture
def owner(client, monkeypatch):
    monkeypatch.setattr(settings, "admin_username", None)
    monkeypatch.setattr(settings, "admin_password_hash", None)
    monkeypatch.setattr("api.modules.admin.auth._client", lambda request: "127.0.0.1")
    response = client.post(
        "/admin/api/setup",
        json={"username": "owner-teste", "password": PASSWORD},
        headers=HEADERS,
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"stage": "enroll"}
    secret, recovery = enroll(client)
    profile = client.get("/admin/api/session").json()["user"]
    return {
        "client": client,
        "secret": secret,
        "recovery": recovery,
        "user": profile,
        "cookies": dict(client.cookies),
    }


def test_senha_e_cadastro_sem_mfa_nao_abrem_rotas_privilegiadas(client, monkeypatch):
    monkeypatch.setattr(settings, "admin_username", None)
    monkeypatch.setattr(settings, "admin_password_hash", None)
    monkeypatch.setattr("api.modules.admin.auth._client", lambda request: "127.0.0.1")
    assert (
        client.post(
            "/admin/api/setup",
            json={"username": "owner-teste", "password": PASSWORD},
            headers=HEADERS,
        ).json()["stage"]
        == "enroll"
    )
    assert client.get("/admin/api/overview").status_code == 401
    assert client.get("/admin/api/accounts").status_code == 401
    assert client.get("/admin/api/mfa/enroll").status_code == 200
    enroll(client)
    assert client.get("/admin/api/overview").status_code == 200
    assert client.get("/admin/api/mfa/enroll").status_code == 401


def test_totp_nao_pode_ser_reutilizado_e_recuperacao_e_uso_unico(owner):
    client = owner["client"]
    code = pyotp.TOTP(owner["secret"]).now()
    assert (
        client.post(
            "/admin/api/login",
            json={"username": "owner-teste", "password": PASSWORD},
            headers=HEADERS,
        ).json()["stage"]
        == "verify"
    )
    assert client.get("/admin/api/overview").status_code == 401
    assert (
        client.post(
            "/admin/api/mfa/verify", json={"code": code}, headers=HEADERS
        ).status_code
        == 401
    )
    recovery = owner["recovery"][0]
    assert (
        client.post(
            "/admin/api/mfa/verify", json={"code": recovery}, headers=HEADERS
        ).status_code
        == 200
    )
    assert client.get("/admin/api/overview").status_code == 200
    client.post(
        "/admin/api/login",
        json={"username": "owner-teste", "password": PASSWORD},
        headers=HEADERS,
    )
    assert (
        client.post(
            "/admin/api/mfa/verify", json={"code": recovery}, headers=HEADERS
        ).status_code
        == 401
    )


def test_totp_fica_cifrado_e_codigos_de_recuperacao_nunca_ficam_em_texto(
    owner, database
):
    with database() as session:
        row = session.execute(
            text(
                "SELECT totp_secret, recovery_hashes, password_hash FROM admin_accounts"
            )
        ).one()
    assert row.totp_secret.startswith("v2:")
    assert owner["secret"] not in row.totp_secret
    assert not any(code in str(row) for code in owner["recovery"])
    assert row.password_hash.startswith("$argon2id$")
    assert PASSWORD not in str(row)


@pytest.fixture
def roles(owner):
    client = owner["client"]
    result = {"owner": owner["cookies"]}
    users = {"owner": owner["user"]}
    for role in ["administrator", "moderator"]:
        client.cookies.clear()
        client.cookies.update(owner["cookies"])
        created = client.post(
            "/admin/api/accounts",
            json={"username": f"{role}-teste", "password": PASSWORD, "role": role},
            headers=HEADERS,
        )
        assert created.status_code == 201, created.text
        users[role] = created.json()
        client.cookies.clear()
        assert (
            client.post(
                "/admin/api/login",
                json={"username": f"{role}-teste", "password": PASSWORD},
                headers=HEADERS,
            ).status_code
            == 200
        )
        enroll(client)
        result[role] = dict(client.cookies)
    return client, result, users


@pytest.mark.parametrize("role", ["moderator", "administrator", "owner"])
def test_matriz_de_permissoes_e_verificada_diretamente_nos_endpoints(roles, role):
    client, cookies, _ = roles
    client.cookies.clear()
    client.cookies.update(cookies[role])
    operations = [
        ("GET", "/overview", None, {"administrator", "owner"}),
        ("GET", "/series", None, {"administrator", "owner"}),
        ("GET", "/breakdown", None, {"administrator", "owner"}),
        ("GET", "/log", None, {"administrator", "owner"}),
        ("GET", "/accounts", None, {"administrator", "owner"}),
        ("GET", "/content/post", None, {"moderator", "administrator", "owner"}),
        ("GET", "/reports", None, {"moderator", "administrator", "owner"}),
        ("GET", "/tutorials", None, {"moderator", "administrator", "owner"}),
        ("GET", "/moderation/summary", None, {"moderator", "administrator", "owner"}),
        ("PUT", "/flags/forum", {"enabled": True}, {"administrator", "owner"}),
        ("PUT", "/menu/grupos", {"visible": True}, {"administrator", "owner"}),
        ("PUT", "/texts/monitor_url", {"value": ""}, {"administrator", "owner"}),
        ("POST", "/maintenance", {}, {"owner"}),
    ]
    for method, path, body, permitted in operations:
        response = client.request(
            method, "/admin/api" + path, json=body, headers=HEADERS
        )
        assert response.status_code == (200 if role in permitted else 403), (
            role,
            path,
            response.text,
        )


def test_administrador_so_gerencia_moderadores_e_owner_e_protegido(roles):
    client, cookies, users = roles
    client.cookies.clear()
    client.cookies.update(cookies["administrator"])
    for role in ["administrator", "owner"]:
        assert (
            client.post(
                "/admin/api/accounts",
                json={"username": "escalada-teste", "password": PASSWORD, "role": role},
                headers=HEADERS,
            ).status_code
            == 403
        )
    for role in ["administrator", "owner"]:
        assert (
            client.patch(
                f"/admin/api/accounts/{users[role]['id']}",
                json={"enabled": False},
                headers=HEADERS,
            ).status_code
            == 403
        )
    moderator = users["moderator"]["id"]
    assert (
        client.patch(
            f"/admin/api/accounts/{moderator}",
            json={"role": "administrator"},
            headers=HEADERS,
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"/admin/api/accounts/{moderator}", json={"enabled": False}, headers=HEADERS
        ).status_code
        == 200
    )
    client.cookies.clear()
    client.cookies.update(cookies["moderator"])
    assert client.get("/admin/api/reports").status_code == 401
    client.cookies.clear()
    client.cookies.update(cookies["owner"])
    assert (
        client.delete(
            f"/admin/api/accounts/{users['owner']['id']}", headers=HEADERS
        ).status_code
        == 403
    )


def test_logout_revoga_sessao_no_servidor_e_cookie_copiado_nao_volta(owner):
    client = owner["client"]
    stolen = dict(client.cookies)
    assert client.post("/admin/api/logout", headers=HEADERS).status_code == 204
    client.cookies.update(stolen)
    assert client.get("/admin/api/overview").status_code == 401


def test_falhas_mfa_bloqueiam_conta_e_nao_vazam_codigo(owner, caplog):
    client = owner["client"]
    client.post(
        "/admin/api/login",
        json={"username": "owner-teste", "password": PASSWORD},
        headers=HEADERS,
    )
    wrong = next(
        code
        for code in ["000000", "111111", "222222", "333333"]
        if not pyotp.TOTP(owner["secret"]).verify(code, valid_window=1)
    )
    for _ in range(5):
        assert (
            client.post(
                "/admin/api/mfa/verify", json={"code": wrong}, headers=HEADERS
            ).status_code
            == 401
        )
    assert (
        client.post(
            "/admin/api/mfa/verify",
            json={"code": owner["recovery"][0]},
            headers=HEADERS,
        ).status_code
        == 429
    )
    assert wrong not in caplog.text
    assert PASSWORD not in caplog.text


def test_transferencia_owner_exige_verificacao_reforcada_e_revoga_sessoes(
    roles, owner, database
):
    client, cookies, users = roles
    client.cookies.clear()
    client.cookies.update(cookies["owner"])
    target = users["administrator"]["id"]
    assert (
        client.post(
            f"/admin/api/ownership/{target}",
            json={"password": "senha-errada-sintetica", "code": owner["recovery"][0]},
            headers=HEADERS,
        ).status_code
        == 401
    )
    assert (
        client.post(
            f"/admin/api/ownership/{target}",
            json={"password": PASSWORD, "code": owner["recovery"][0]},
            headers=HEADERS,
        ).status_code
        == 204
    )
    assert client.get("/admin/api/overview").status_code == 401
    with database() as session:
        assert session.scalars(
            select(AdminAccount.username).where(AdminAccount.role == "owner")
        ).all() == ["administrator-teste"]


def test_recuperacao_local_invalida_sessoes_fatores_e_codigos_sem_apagar_owner(
    owner, maintenance_database, database
):
    import asyncio

    from api.modules.admin.recovery import configure_owner

    client = owner["client"]
    new_password = "nova-senha-sintetica-do-owner"
    asyncio.run(
        configure_owner(maintenance_database, "owner-teste", new_password, recover=True)
    )
    assert client.get("/admin/api/overview").status_code == 401
    with database() as session:
        account = session.scalar(select(AdminAccount))
        assert account.role == "owner" and not account.totp_confirmed
        assert account.totp_secret is None and not account.recovery_hashes
    response = client.post(
        "/admin/api/login",
        json={"username": "owner-teste", "password": new_password},
        headers=HEADERS,
    )
    assert response.json() == {"stage": "enroll"}
    enrollment = client.get("/admin/api/mfa/enroll").json()
    assert enrollment["secret"] != owner["secret"]
    assert (
        client.post(
            "/admin/api/mfa/confirm",
            json={"code": owner["recovery"][0]},
            headers=HEADERS,
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/admin/api/mfa/confirm",
            json={"code": pyotp.TOTP(enrollment["secret"]).now()},
            headers=HEADERS,
        ).status_code
        == 200
    )
