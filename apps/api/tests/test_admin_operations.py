import importlib.util
import pathlib

import pytest

from api import maintenance, metrics, resilience

_spec = importlib.util.spec_from_file_location(
    "admin_security_fixtures",
    pathlib.Path(__file__).with_name("test_admin_security.py"),
)
_fixtures = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_fixtures)
HEADERS, owner, roles = _fixtures.HEADERS, _fixtures.owner, _fixtures.roles


def como(client, cookies):
    client.cookies.clear()
    client.cookies.update(cookies)


@pytest.fixture(autouse=True)
def manutencao_limpa(client):
    from api.db.main import get_sessionmaker
    from api.main import app

    # o middleware lê o estado com a própria sessão: aponta para o banco do teste
    original = maintenance.async_session
    maintenance.async_session = app.dependency_overrides[get_sessionmaker]()
    maintenance.invalidate()
    metrics.reset()
    yield
    maintenance.async_session = original
    maintenance.invalidate()


@pytest.mark.parametrize(
    "cargo,esperado", [("moderator", 403), ("administrator", 200), ("owner", 200)]
)
def test_visao_ao_vivo_exige_operacoes(roles, cargo, esperado):
    client, cookies, _ = roles
    como(client, cookies[cargo])
    assert (
        client.get("/admin/api/operations/live", headers=HEADERS).status_code
        == esperado
    )


def test_atividade_conta_pedidos_e_nao_pessoas(roles):
    client, cookies, _ = roles
    client.cookies.clear()
    for _ in range(5):
        client.get("/public/config")
    como(client, cookies["administrator"])
    live = client.get("/admin/api/operations/live", headers=HEADERS).json()
    atividade = live["activity"]
    assert atividade["scope"] == "current_process"
    assert (
        atividade["last_5_minutes"] >= 5
        and atividade["last_hour"] >= atividade["last_5_minutes"]
    )
    assert atividade["in_flight"] >= 1  # o próprio pedido ao painel
    assert atividade["latency_ms"]["p50"] is not None
    # nada que identifique alguém: só números agregados
    assert "ip" not in str(atividade).lower() and "user" not in str(atividade).lower()
    assert (
        live["database"]["connections"] >= 1 and live["database"]["max_connections"] > 0
    )
    assert live["process"]["pid"] > 0
    assert (
        live["restart"]["available"] is False
    )  # sem orquestrador seguro, sem botão enganoso


def test_erros_sao_somados_por_modulo(roles):
    assert roles
    metrics.observe_request("GET", "/forum/{post_id}", 500, 12.0)
    metrics.observe_request("GET", "/forum", 502, 9.0)
    metrics.observe_request("GET", "/public/subjects", 200, 5.0)
    atividade = metrics.activity()
    assert atividade["errors_24_hours"] == 2
    assert atividade["errors_by_module_24_hours"] == {"forum": 2}


def test_limpar_cache_publico_e_auditado_e_exige_operacoes(roles):
    from api.modules.public_classrooms import service

    client, cookies, _ = roles
    service.UNITS_CACHE._store["units"] = ("x", 0.0)
    como(client, cookies["moderator"])
    corpo = {"target": "units"}
    assert (
        client.post(
            "/admin/api/operations/cache/clear", json=corpo, headers=HEADERS
        ).status_code
        == 403
    )
    assert service.UNITS_CACHE._store
    como(client, cookies["administrator"])
    assert client.post(
        "/admin/api/operations/cache/clear", json=corpo, headers=HEADERS
    ).json() == {"cleared": ["units"]}
    assert not service.UNITS_CACHE._store
    assert (
        client.post(
            "/admin/api/operations/cache/clear", json={"target": "sql"}, headers=HEADERS
        ).status_code
        == 422
    )
    como(client, cookies["owner"])
    log = client.get("/admin/api/log", headers=HEADERS).json()
    assert any(
        e["action"] == "admin.cache_cleared" and e["detail"] == "units" for e in log
    )


def test_modo_de_manutencao_so_o_owner_liga_e_o_painel_continua_aberto(roles):
    client, cookies, _ = roles
    corpo = {"enabled": True}
    for cargo in ("moderator", "administrator"):
        como(client, cookies[cargo])
        assert (
            client.put(
                "/admin/api/operations/maintenance", json=corpo, headers=HEADERS
            ).status_code
            == 403
        )
    como(client, cookies["owner"])
    assert client.put(
        "/admin/api/operations/maintenance", json=corpo, headers=HEADERS
    ).json() == {"maintenance": True}
    # o app público recebe 503; o painel, a configuração pública e o próprio desligamento continuam
    client.cookies.clear()
    bloqueado = client.get("/forum")
    assert bloqueado.status_code == 503 and bloqueado.headers["Retry-After"] == "120"
    assert client.get("/public/subjects/FGA0030/outcomes").status_code == 503
    assert client.get("/public/config").status_code == 200
    como(client, cookies["owner"])
    assert (
        client.get("/admin/api/operations/live", headers=HEADERS).json()["maintenance"]
        is True
    )
    assert client.put(
        "/admin/api/operations/maintenance", json={"enabled": False}, headers=HEADERS
    ).json() == {"maintenance": False}
    client.cookies.clear()
    assert client.get("/forum").status_code == 200
    como(client, cookies["owner"])
    log = client.get("/admin/api/log", headers=HEADERS).json()
    assert {"admin.maintenance_on", "admin.maintenance_off"} <= {
        e["action"] for e in log
    }


def test_modo_de_manutencao_exige_mfa_recente(roles, monkeypatch):
    from api.modules.admin import auth

    client, cookies, _ = roles
    como(client, cookies["owner"])
    real = auth.timedelta
    monkeypatch.setattr(auth, "timedelta", lambda **kw: real(seconds=-1))
    resposta = client.put(
        "/admin/api/operations/maintenance", json={"enabled": True}, headers=HEADERS
    )
    assert resposta.status_code == 403 and "MFA" in resposta.json()["detail"]


def test_taxa_de_cache_aparece_no_painel(roles):
    client, cookies, _ = roles
    resilience.count("cache.hit", 3)
    resilience.count("cache.miss", 1)
    como(client, cookies["administrator"])
    cache = client.get("/admin/api/operations/live", headers=HEADERS).json()["cache"]
    assert cache["hits"] == 3 and cache["misses"] == 1 and cache["hit_rate"] == 0.75
