import pytest

from api import metrics


@pytest.fixture(autouse=True)
def reset():
    metrics.reset()
    yield
    metrics.reset()


def test_percentis_contam_amostra_limitada_sem_guardar_parametros():
    for value in range(1, 301):
        metrics.observe_request(
            "GET",
            "/classrooms/{classroom_id}/frequency",
            500 if value % 100 == 0 else 200,
            value,
        )
    row = metrics.snapshot()["routes"][0]
    assert row["requests"] == 300 and row["errors"] == 3 and row["samples"] == 200
    assert row["p50_ms"] == 200 and row["p95_ms"] == 290
    assert row["route"] == "/classrooms/{classroom_id}/frequency"


def test_quantidade_de_rotas_e_limitada_e_origens_nao_recebem_corpos():
    for value in range(1000):
        metrics.observe_request("GET", f"/synthetic/{value}", 200, 1)
    assert len(metrics.snapshot()["routes"]) <= 257
    metrics.observe_origin("sigaa.connect.completed", {"duration_ms": 20})
    assert metrics.snapshot()["origins"]["sigaa"]["duration_ms"] == 20


def test_metricas_da_rota_desconhecida_nao_guardam_identificadores(client):
    client.get("/identificador-privado-sintetico?senha=segredo")
    data = str(metrics.snapshot())
    assert "identificador-privado-sintetico" not in data
    assert "segredo" not in data
    assert "unmatched" in data
