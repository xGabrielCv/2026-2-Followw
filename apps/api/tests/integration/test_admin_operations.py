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
    log = client.get("/admin/api/log", headers=HEADERS).json()["items"]
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
    log = client.get("/admin/api/log", headers=HEADERS).json()["items"]
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


def test_operacoes_expoe_pools_cotas_e_tres_circuitos_com_recuperacao_auditada(roles):
    from api.modules.public_classrooms.service import UNITS_ORIGIN
    from api.modules.public_subjects.router import SEARCH_RESPONSES

    client, cookies, _ = roles
    for _ in range(5):
        UNITS_ORIGIN.breaker.failure()
    assert UNITS_ORIGIN.breaker.state == "open"
    SEARCH_RESPONSES._store["q"] = ([], 0.0)

    como(client, cookies["administrator"])
    live = client.get("/admin/api/operations/live", headers=HEADERS).json()
    assert "http_pool" in live and live["http_pool"]["max_concurrent"] > 0
    assert "session_lock" in live
    assert live["rate_limit"]["backend"] in {"memory", "postgres", "redis"}
    assert {"ru", "sigaa_units", "sigaa_classrooms"} <= live["origins"].keys()
    assert live["origins"]["sigaa_units"]["circuit"] == "open"

    rec = client.post(
        "/admin/api/operations/origins/sigaa_units/recover", headers=HEADERS
    )
    assert rec.status_code == 200
    assert UNITS_ORIGIN.breaker.state == "closed"

    limpo = client.post(
        "/admin/api/operations/cache/clear",
        json={"target": "subjects"},
        headers=HEADERS,
    )
    assert limpo.status_code == 200 and limpo.json() == {"cleared": ["subjects"]}
    assert not SEARCH_RESPONSES._store

    log = client.get("/admin/api/log", headers=HEADERS).json()["items"]
    assert any(
        e["action"] == "admin.origin_recovered" and e["target_id"] == "sigaa_units"
        for e in log
    )


def test_previa_e_execucao_de_manutencao_limpam_efemeros_vencidos_sem_tocar_ativos(
    roles, database
):
    from datetime import UTC, datetime, timedelta
    from time import time
    from uuid import uuid4

    from sqlalchemy import text

    from api.modules.admin.models import AdminAccount, AdminSession
    from api.modules.logs.models import AppEvent

    client, cookies, _ = roles
    agora = datetime.now(UTC)
    with database.begin() as session:
        conta = session.query(AdminAccount).first()
        session.add(
            AdminSession(
                id=uuid4(),
                account_id=conta.id,
                token_hash="expirada-hash-sintetica",
                session_version=conta.session_version,
                expires_at=agora - timedelta(hours=1),
                revoked=True,
            )
        )
        session.add(
            AppEvent(
                at=agora - timedelta(days=365),
                level="WARNING",
                event="test.old",
                fields={},
            )
        )
        session.add(
            AppEvent(
                at=agora,
                level="INFO",
                event="test.fresh",
                fields={},
            )
        )
        session.execute(
            text(
                "INSERT INTO rate_windows(bucket, window_start, count) VALUES "
                "('old_bucket', :old, 2), ('fresh_bucket', :fresh, 1)"
            ),
            {"old": int(time()) - 100_000, "fresh": int(time())},
        )

    como(client, cookies["owner"])
    previa = client.get("/admin/api/maintenance/preview", headers=HEADERS)
    assert previa.status_code == 200
    contagens = previa.json()
    assert contagens["sessões administrativas encerradas"] >= 1
    assert contagens["janelas de cota vencidas"] >= 1
    assert contagens["eventos técnicos vencidos"] >= 1

    limpeza = client.post("/admin/api/maintenance", headers=HEADERS)
    assert limpeza.status_code == 200
    resultado = limpeza.json()
    assert resultado["sessões administrativas encerradas"] >= 1
    assert resultado["janelas de cota vencidas"] >= 1
    assert resultado["eventos técnicos vencidos"] >= 1

    depois = client.get("/admin/api/maintenance/preview", headers=HEADERS).json()
    assert depois["sessões administrativas encerradas"] == 0
    assert depois["janelas de cota vencidas"] == 0
    assert depois["eventos técnicos vencidos"] == 0


def test_mensagem_de_manutencao_e_banner_operacional_publico_com_expiracao(roles):
    from datetime import UTC, datetime, timedelta

    client, cookies, _ = roles
    como(client, cookies["owner"])
    assert (
        client.put(
            "/admin/api/operations/maintenance",
            json={
                "enabled": True,
                "message": "Atualizando banco local. Voltamos às 03h.",
            },
            headers=HEADERS,
        ).status_code
        == 200
    )
    client.cookies.clear()
    bloqueado = client.get("/forum")
    assert bloqueado.status_code == 503
    assert "Voltamos às 03h" in bloqueado.json()["detail"]

    como(client, cookies["owner"])
    client.put(
        "/admin/api/operations/maintenance", json={"enabled": False}, headers=HEADERS
    )

    como(client, cookies["administrator"])
    futuro = (datetime.now(UTC) + timedelta(hours=2)).isoformat()
    salvo = client.put(
        "/admin/api/operations/banner",
        json={
            "enabled": True,
            "level": "warning",
            "title": "Instabilidade no SIGAA",
            "message": "O SIGAA está lento hoje; dados salvos continuam disponíveis.",
            "expires_at": futuro,
        },
        headers=HEADERS,
    )
    assert salvo.status_code == 200
    cfg = client.get("/public/config").json()
    assert cfg["banner"]["title"] == "Instabilidade no SIGAA"
    assert cfg["banner"]["level"] == "warning"

    passado = (datetime.now(UTC) - timedelta(minutes=5)).isoformat()
    client.put(
        "/admin/api/operations/banner",
        json={
            "enabled": True,
            "level": "info",
            "title": "Expirado",
            "message": "Não deve aparecer.",
            "expires_at": passado,
        },
        headers=HEADERS,
    )
    assert client.get("/public/config").json()["banner"] is None
