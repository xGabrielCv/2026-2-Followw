"""Defesas de toda requisição: origem, tamanho do corpo e cabeçalhos."""

import pytest

from api.core.config import settings
from api.rate_limit import _MEMORY, _limit


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


async def test_sem_redis_em_producao_a_cota_fica_na_memoria(monkeypatch):
    monkeypatch.setattr(settings, "environment", "production")
    _MEMORY.clear()
    resultados = [await _limit("teste", "1.2.3.4", 2, 60) for _ in range(3)]
    assert [r.allowed for r in resultados] == [True, True, False]
    monkeypatch.setattr(settings, "environment", "testing")
    assert not (await _limit("teste", "1.2.3.4", 2, 60)).allowed
