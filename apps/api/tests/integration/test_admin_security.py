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

    def endpoints(router, prefix=""):
        for route in router.routes:
            if isinstance(route, APIRoute):
                yield prefix + route.path, route
            elif hasattr(route, "original_router"):
                yield from endpoints(
                    route.original_router, prefix + route.include_context.prefix
                )

    checked = 0
    paths = set()
    for path, route in endpoints(api):
        paths.add(path)
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
    assert checked >= 40
    assert {"/moderation/batch", "/limits", "/operations/live", "/tickets"} <= paths


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


def test_calendario_alerta_e_bandeira_respeitam_rbac_e_refletem_no_public_config(roles):
    client, cookies, _ = roles

    client.cookies.clear()
    client.cookies.update(cookies["moderator"])
    assert client.get("/admin/api/calendar").status_code == 403
    assert client.get("/admin/api/alert").status_code == 403
    assert (
        client.put(
            "/admin/api/flags/current_plan", json={"enabled": True}, headers=HEADERS
        ).status_code
        == 403
    )

    client.cookies.clear()
    client.cookies.update(cookies["administrator"])
    assert (
        client.put(
            "/admin/api/flags/current_plan", json={"enabled": True}, headers=HEADERS
        ).status_code
        == 200
    )

    semestre_custom = {
        "2030.1": {
            "semester": "2030.1",
            "name": "2030.1",
            "period": {"start": "2030-03-01", "end": "2030-07-15"},
            "classes": {
                "start": "2030-03-01",
                "end": "2030-07-10",
                "instructional_days": 100,
            },
            "events": [
                {
                    "id": "enrollment",
                    "name": "Matrícula regular",
                    "start_date": "2030-03-01",
                    "end_date": "2030-03-05",
                    "category": "enrollment",
                }
            ],
        }
    }
    assert (
        client.put(
            "/admin/api/calendar",
            json={"semesters": semestre_custom},
            headers=HEADERS,
        ).status_code
        == 200
    )
    alerta_res = client.put(
        "/admin/api/alert",
        json={
            "enabled": True,
            "always_on": False,
            "preset": "first_day",
            "title": "Avalie o semestre",
            "message": "Mensagem personalizada de início do semestre.",
            "mid_semester_enabled": True,
            "mid_semester_every_n": 3,
            "mid_semester_title": "Metade",
            "mid_semester_message": "Hora de avaliar seus docentes.",
            "last_day_enabled": True,
            "last_day_title": "Último dia do semestre",
            "last_day_message": "Avalie hoje no último dia.",
            "first_day_enabled": True,
            "first_day_title": "Semestre anterior",
            "first_day_message": "Avalie o semestre anterior.",
            "trigger_id": "t1",
            "triggered_at": None,
        },
        headers=HEADERS,
    )
    assert alerta_res.status_code == 200

    disparo = client.post(
        "/admin/api/alert/trigger",
        json={"title": "Avalie o semestre"},
        headers=HEADERS,
    )
    assert disparo.status_code == 200
    novo_id = disparo.json()["trigger_id"]
    assert novo_id != "t1"
    assert disparo.json()["triggered_at"] is not None

    publico = client.get("/public/config")
    assert publico.status_code == 200
    dados = publico.json()
    assert dados["flags"]["current_plan"] is True
    assert "2030.1" in dados["calendar"]
    assert dados["alert"]["trigger_id"] == novo_id

    overview = client.get("/admin/api/overview", headers=HEADERS)
    assert overview.status_code == 200
    assert "yara-x" in overview.json()["scanner_engines"]

    recusas = client.get("/admin/api/materials/rejections", headers=HEADERS)
    assert recusas.status_code == 200
    assert recusas.json()["total"] == 0

    limpeza = client.delete("/admin/api/materials/rejections", headers=HEADERS)
    assert limpeza.status_code == 200
    assert limpeza.json()["deleted"] == 0


def test_salvar_formulario_antigo_nao_desfaz_campanha_nova_e_publico_reflete_desativacao(
    owner,
):
    client = owner["client"]
    stale = client.get("/admin/api/alert").json()["config"]
    first = client.post(
        "/admin/api/alert/trigger", json={"title": "Campanha nova"}, headers=HEADERS
    ).json()
    version = client.get("/public/config/version").json()["parts"]["config"]
    stale.update(enabled=False, always_on=True)
    saved = client.put("/admin/api/alert", json=stale, headers=HEADERS)
    assert saved.status_code == 200
    assert saved.json()["trigger_id"] == first["trigger_id"]
    assert saved.json()["triggered_at"] == first["triggered_at"]
    public = client.get("/public/config").json()["alert"]
    assert public["enabled"] is False
    assert public["trigger_id"] == first["trigger_id"]
    assert client.get("/public/config/version").json()["parts"]["config"] != version
    second = client.post("/admin/api/alert/trigger", json={}, headers=HEADERS).json()
    assert second["enabled"] is True
    assert second["trigger_id"] != first["trigger_id"]


def test_alerta_recusa_textos_vazios_longos_e_cadencia_invalida(owner):
    client = owner["client"]
    for body in ({"title": " "}, {"title": "a" * 121}, {"message": "a" * 601}):
        assert (
            client.post(
                "/admin/api/alert/trigger", json=body, headers=HEADERS
            ).status_code
            == 422
        )
    for count in (0, 21):
        assert (
            client.put(
                "/admin/api/alert",
                json={"mid_semester_every_n": count},
                headers=HEADERS,
            ).status_code
            == 422
        )
    assert (
        client.put(
            "/admin/api/alert", json={"title": "   "}, headers=HEADERS
        ).status_code
        == 422
    )
