import importlib.util
import pathlib

import pytest
from sqlalchemy import text

from api import metrics, resilience

_spec = importlib.util.spec_from_file_location(
    "admin_security_fixtures",
    pathlib.Path(__file__).with_name("test_admin_security.py"),
)
_fixtures = _spec and importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_fixtures)
HEADERS, owner, roles = _fixtures.HEADERS, _fixtures.owner, _fixtures.roles


def como(client, cookies):
    client.cookies.clear()
    client.cookies.update(cookies)


def popular(database):
    with database.begin() as session:
        session.execute(
            text(
                "INSERT INTO active_users(period, key) VALUES ('d:2026-11-08','k1'),('w:2026-W45','k2')"
            )
        )
        session.execute(
            text(
                "INSERT INTO forum_posts (id, kind, title, body, author_key, reply_count, last_activity_at) "
                "VALUES (gen_random_uuid(), 'duvida', 'v2:x', 'v2:y', 'a', 0, now())"
            )
        )


def contagens(database):
    with database() as session:
        return {
            tabela: session.execute(text(f"SELECT count(*) FROM {tabela}")).scalar_one()
            for tabela in (
                "active_users",
                "forum_posts",
                "admin_accounts",
                "admin_log",
                "system_flags",
            )
        }


@pytest.mark.parametrize(
    "cargo,esperado", [("moderator", 403), ("administrator", 403), ("owner", 200)]
)
def test_so_o_owner_ve_a_previa_e_redefine(roles, cargo, esperado):
    client, cookies, _ = roles
    como(client, cookies[cargo])
    assert (
        client.get("/admin/api/statistics/reset-preview", headers=HEADERS).status_code
        == esperado
    )
    body = {"groups": ["requests"], "confirmation": "REDEFINIR"}
    assert (
        client.post(
            "/admin/api/statistics/reset", json=body, headers=HEADERS
        ).status_code
        == esperado
    )


def test_sem_sessao_nao_redefine(client):
    assert (
        client.post(
            "/admin/api/statistics/reset",
            json={"groups": ["usage"], "confirmation": "REDEFINIR"},
            headers=HEADERS,
        ).status_code
        == 401
    )


def test_exige_confirmacao_e_grupos_validos(roles):
    client, cookies, _ = roles
    como(client, cookies["owner"])
    for body in (
        {"groups": ["usage"], "confirmation": "sim"},
        {"groups": ["usage"], "confirmation": ""},
    ):
        assert (
            client.post(
                "/admin/api/statistics/reset", json=body, headers=HEADERS
            ).status_code
            == 422
        )
    for body in (
        {"groups": [], "confirmation": "REDEFINIR"},
        {"groups": ["tickets"], "confirmation": "REDEFINIR"},
        {"confirmation": "REDEFINIR"},
    ):
        assert (
            client.post(
                "/admin/api/statistics/reset", json=body, headers=HEADERS
            ).status_code
            == 422
        )


def test_redefinir_uso_zera_so_os_contadores_e_preserva_o_conteudo(roles, database):
    client, cookies, _ = roles
    popular(database)
    antes = contagens(database)
    assert antes["active_users"] == 2 and antes["forum_posts"] == 1
    como(client, cookies["owner"])
    previa = client.get("/admin/api/statistics/reset-preview", headers=HEADERS).json()
    assert {g["id"]: g["items"] for g in previa["groups"]}["usage"] == 2
    assert (
        "log de auditoria" in previa["protected"]
        and previa["summary"]["usage_rows"] == 2
    )
    resposta = client.post(
        "/admin/api/statistics/reset",
        json={"groups": ["usage"], "confirmation": "REDEFINIR"},
        headers=HEADERS,
    )
    assert resposta.status_code == 200 and resposta.json() == {"cleared": {"usage": 2}}
    depois = contagens(database)
    assert depois["active_users"] == 0
    assert depois["forum_posts"] == antes["forum_posts"]
    assert depois["admin_accounts"] == antes["admin_accounts"]
    assert depois["system_flags"] == antes["system_flags"]
    assert (
        depois["admin_log"] > antes["admin_log"]
    )  # a ação foi auditada, nada foi apagado
    log = client.get("/admin/api/log", headers=HEADERS).json()
    assert any(
        e["action"] == "admin.statistics_reset" and e["detail"] == "usage" for e in log
    )


def test_redefinir_memoria_zera_metricas_e_contadores_sem_tocar_no_banco(
    roles, database
):
    client, cookies, _ = roles
    popular(database)
    metrics.observe_request("GET", "/x", 200, 5.0)
    resilience.count("origin.teste.calls", 3)
    como(client, cookies["owner"])
    resposta = client.post(
        "/admin/api/statistics/reset",
        json={"groups": ["requests", "origins"], "confirmation": "REDEFINIR"},
        headers=HEADERS,
    )
    assert resposta.status_code == 200
    assert resilience.counters() == {}
    assert all(row["route"] != "/x" for row in metrics.snapshot()["routes"])
    assert contagens(database)["active_users"] == 2  # uso não foi pedido


def test_redefinir_exige_mfa_recente(roles, monkeypatch):
    from datetime import timedelta

    from api.modules.admin import auth

    client, cookies, _ = roles
    como(client, cookies["owner"])
    real = auth.timedelta
    monkeypatch.setattr(auth, "timedelta", lambda **kw: real(seconds=-1))
    resposta = client.post(
        "/admin/api/statistics/reset",
        json={"groups": ["requests"], "confirmation": "REDEFINIR"},
        headers=HEADERS,
    )
    assert resposta.status_code == 403 and "MFA" in resposta.json()["detail"]
    assert timedelta  # silencia import não usado
