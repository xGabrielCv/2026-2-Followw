"""Defesas de toda requisição: origem, tamanho do corpo e cabeçalhos."""

import pytest

from api.core.config import settings
from api.rate_limit import _MEMORY, _limit


@pytest.mark.parametrize(
    "origin",
    [
        "https://[",
        "ftp://testserver",
        "https://testserver:invalida",
        "https://testserver/caminho",
        "https://testserver?consulta=1",
        "https://testserver#fragmento",
        "https://usuario@testserver",
        "http://testserver",
    ],
)
def test_origem_invalida_ou_insegura_e_recusada_sem_erro_interno(monkeypatch, origin):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from api.security import SecurityMiddleware

    monkeypatch.setattr(settings, "environment", "production")
    app = FastAPI()
    app.add_middleware(SecurityMiddleware)

    @app.post("/escrever")
    def escrever():
        return {"ok": True}

    with TestClient(app, base_url="https://testserver") as navegador:
        response = navegador.post("/escrever", headers={"Origin": origin})
        assert response.status_code == 403
        assert (
            navegador.post(
                "/escrever", headers={"Origin": "https://testserver"}
            ).status_code
            == 200
        )


def test_respostas_trazem_cabecalhos_de_seguranca(client):
    response = client.get("/public/restaurant/campuses")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert "strict-transport-security" not in response.headers


@pytest.mark.parametrize("origin", ["https://site-malicioso.com", "null"])
def test_escrita_vinda_de_outro_site_e_recusada(client, origin):
    response = client.post(
        "/reports",
        json={
            "target_type": "post",
            "target_id": "00000000-0000-0000-0000-000000000000",
            "reason": "spam",
        },
        headers={"Origin": origin},
    )
    assert response.status_code == 403


def test_escrita_do_proprio_app_passa(client):
    response = client.post(
        "/reports",
        json={
            "target_type": "post",
            "target_id": "00000000-0000-0000-0000-000000000000",
            "reason": "spam",
        },
        headers={"Origin": "https://followw.app"},
    )
    # passou da origem: só não achou o conteúdo
    assert response.status_code == 404


def test_corpo_grande_demais_e_recusado_antes_da_rota(client):
    response = client.post(
        "/reports",
        content=b"x" * (300 * 1024),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413


def test_tamanho_declarado_menor_nao_contorna_limite_efetivo(client):
    response = client.post(
        "/reports",
        content=b"x" * (300 * 1024),
        headers={"Content-Type": "application/json", "Content-Length": "1"},
    )
    assert response.status_code == 413
    assert response.headers["cache-control"] == "no-store"


async def test_sem_redis_em_producao_a_cota_fica_na_memoria(monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    _MEMORY.clear()
    resultados = [await _limit("teste", "1.2.3.4", 2, 60) for _ in range(3)]
    assert [r.allowed for r in resultados] == [True, True, False]
    monkeypatch.setattr(settings, "environment", "testing")
    assert not (await _limit("teste", "1.2.3.4", 2, 60)).allowed


def test_multipart_em_rota_comum_nao_ganha_21mb_nem_ocupa_slots_de_upload(client):
    response = client.post(
        "/reports",
        content=b"x" * (300 * 1024),
        headers={
            "Content-Type": "multipart/form-data; boundary=----teste",
            "Origin": "https://followw.app",
        },
    )
    assert response.status_code == 413


@pytest.mark.parametrize("site", ["cross-site", "same-site"])
def test_escrita_sem_origin_mas_com_sec_fetch_site_externo_e_recusada(client, site):
    response = client.post(
        "/reports",
        json={
            "target_type": "post",
            "target_id": "00000000-0000-0000-0000-000000000000",
            "reason": "spam",
        },
        headers={"Sec-Fetch-Site": site},
    )
    assert response.status_code == 403


async def test_producao_sem_backend_compartilhado_recusa_cota_sensivel(monkeypatch):
    from fastapi import HTTPException

    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "rate_limit_backend", "memory")
    monkeypatch.setattr(settings, "upstash_redis_rest_url", None)
    _MEMORY.clear()
    with pytest.raises(HTTPException) as erro:
        await _limit("login", "1.2.3.4", 5, 60, shared=True)
    assert erro.value.status_code == 503


def test_proxy_confiavel_extrai_ip_real_de_x_forwarded_for_sem_aceitar_spoofing(
    monkeypatch,
):
    from starlette.requests import Request

    from api.rate_limit import _client_host

    monkeypatch.setattr(settings, "trusted_proxies", ["127.0.0.1", "172.18.0.0/16"])
    monkeypatch.setattr(settings, "rate_limit_secret_key", None)

    # Cliente falando através do proxy confiável (172.18.0.5), tentando forjar 1.1.1.1 no início:
    scope_proxy = {
        "type": "http",
        "client": ("172.18.0.5", 443),
        "headers": [(b"x-forwarded-for", b"1.1.1.1, 203.0.113.42")],
    }
    assert _client_host(Request(scope_proxy)) == "203.0.113.42"

    # Cliente não confiável (198.51.100.9) tentando forjar X-Forwarded-For diretamente:
    scope_direto = {
        "type": "http",
        "client": ("198.51.100.9", 50000),
        "headers": [(b"x-forwarded-for", b"1.1.1.1, 203.0.113.42")],
    }
    assert _client_host(Request(scope_direto)) == "198.51.100.9"


def test_manutencao_nao_bloqueia_painel_admin_com_prefixo_api(client, monkeypatch):
    from api import maintenance

    monkeypatch.setattr(maintenance, "_CACHE", {"on": True, "at": 10**12})
    assert client.get("/api/admin/api/session").status_code == 200
    assert client.get("/api/forum").status_code == 503
