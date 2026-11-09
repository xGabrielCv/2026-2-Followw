import pytest

from api import metrics
from api.db.models import SystemFlag


def enable(database):
    with database.begin() as session:
        session.add(SystemFlag(key="telemetry", enabled=True))
    metrics.reset()


def test_sem_consentimento_ou_com_coleta_desligada_nao_conta(client, database):
    metrics.reset()
    payload = {"event": "login_session_lost"}
    assert (
        client.post(
            "/public/config/metrics", json=payload, headers={"X-Followw-Metrics": "1"}
        ).status_code
        == 204
    )
    assert metrics.snapshot()["client_events"] == {}
    enable(database)
    assert client.post("/public/config/metrics", json=payload).status_code == 204
    assert metrics.snapshot()["client_events"] == {}


def test_com_consentimento_guarda_so_contador_sem_identificador(client, database):
    enable(database)
    response = client.post(
        "/public/config/metrics",
        json={"event": "login_session_lost"},
        headers={"X-Followw-Metrics": "1"},
    )
    assert response.status_code == 204
    assert response.headers["cache-control"] == "no-store"
    assert metrics.snapshot()["client_events"] == {"login_session_lost": 1}
    metrics.reset()
    assert metrics.snapshot()["client_events"] == {}


@pytest.mark.parametrize(
    "extra", ["registration", "password", "url", "error", "ticket", "distinct_id"]
)
def test_recusa_campos_pessoais_sem_repetir_seu_conteudo(
    client, database, extra, caplog
):
    enable(database)
    response = client.post(
        "/public/config/metrics",
        json={"event": "login_session_lost", extra: "marcador-privado"},
        headers={"X-Followw-Metrics": "1"},
    )
    assert response.status_code == 422
    assert "marcador-privado" not in response.text + caplog.text
    assert metrics.snapshot()["client_events"] == {}


def test_recusa_cookies_academicos_e_evento_desconhecido(client, database):
    enable(database)
    response = client.post(
        "/public/config/metrics",
        json={"event": "login_session_lost"},
        headers={"Cookie": "refresh_token=sintetico", "X-Followw-Metrics": "1"},
    )
    assert response.status_code == 400
    assert (
        client.post("/public/config/metrics", json={"event": "pageview"}).status_code
        == 422
    )
    assert metrics.snapshot()["client_events"] == {}
