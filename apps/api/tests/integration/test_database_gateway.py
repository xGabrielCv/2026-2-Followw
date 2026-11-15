import asyncio
import os
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

import httpx
import pytest
import respx
from sqlalchemy import select
from starlette.websockets import WebSocketDisconnect

from api.core.config import settings
from api.modules.admin.models import AdminSession

from . import test_admin_security as fixtures

owner, roles = fixtures.owner, fixtures.roles


@pytest.mark.skipif(
    os.environ.get("FOLLOWW_TEST_CLOUDBEAVER") != "1",
    reason="Exige CloudBeaver local explícito",
)
def test_socket_real_reutiliza_sessao_graphql_pelo_gateway(owner, monkeypatch):
    client = owner["client"]
    monkeypatch.setattr(settings, "cloudbeaver_enabled", True)
    with respx.mock(assert_all_called=False) as remote:
        remote.route(host="127.0.0.1", port=8978).pass_through()
        session = client.post(
            "/admin/database/api/gql",
            json={
                "query": 'mutation { openSession(defaultLocale:"pt_BR") { locale } }'
            },
            headers={"Origin": "https://followw.app"},
        )
        assert session.status_code == 200
        assert not session.json().get("errors")
        # O TestClient usa a URL interna sem o root_path /api do navegador.
        client.cookies.set(
            "cb-session-id", client.cookies.get("cb-session-id"), path="/"
        )
        with client.websocket_connect(
            "/admin/database/api/ws", headers={"Origin": "https://followw.app"}
        ) as socket:
            assert socket.receive_json()["id"] == "cb_session_websocket_connected"


def test_socket_recusa_visitante_e_origem_estrangeira(owner, monkeypatch):
    client = owner["client"]
    monkeypatch.setattr(settings, "cloudbeaver_enabled", True)
    with (
        pytest.raises(WebSocketDisconnect) as denied,
        client.websocket_connect(
            "/admin/database/api/ws", headers={"Origin": "https://externo.invalid"}
        ),
    ):
        pass
    assert denied.value.code == 1008
    client.cookies.clear()
    with (
        pytest.raises(WebSocketDisconnect) as denied,
        client.websocket_connect(
            "/admin/database/api/ws", headers={"Origin": "https://followw.app"}
        ),
    ):
        pass
    assert denied.value.code == 1008


def test_socket_encaminha_conclusao_de_consulta_sem_cookie_do_followw(
    owner, monkeypatch
):
    from api.modules.admin import database_socket

    client = owner["client"]
    monkeypatch.setattr(settings, "cloudbeaver_enabled", True)
    client.cookies.set("cb-session-id", "sessao-sintetica")
    captured = {}

    class EventServer:
        def __init__(self):
            self.messages = asyncio.Queue()

        async def send(self, message):
            await self.messages.put(message)

        def __aiter__(self):
            return self

        async def __anext__(self):
            return await self.messages.get()

    @asynccontextmanager
    async def connect(url, **options):
        captured.update(url=url, options=options)
        yield EventServer()

    monkeypatch.setattr(database_socket, "connect", connect)
    with client.websocket_connect(
        "/admin/database/api/ws", headers={"Origin": "https://followw.app"}
    ) as socket:
        event = {
            "id": "cb_session_task_info",
            "taskId": "consulta-sintetica",
            "running": False,
        }
        socket.send_json(event)
        assert socket.receive_json() == event
        client.post("/admin/api/logout", headers={"X-Admin-Request": "1"})
        socket.send_json(event)
        with pytest.raises(WebSocketDisconnect) as expired:
            socket.receive_json()
        assert expired.value.code == 1008
    assert captured["options"]["additional_headers"] == {
        "Cookie": "cb-session-id=sessao-sintetica",
        "Authorization": "Bearer sessao-sintetica",
    }
    assert captured["options"]["proxy"] is None
    assert captured["url"] == "ws://127.0.0.1:8978/api/admin/database/api/ws"


def test_gerenciador_exige_mfa_recente_e_sessao_nao_revogada(owner, database):
    client = owner["client"]
    with database.begin() as db:
        session = db.scalar(select(AdminSession))
        session.created_at = datetime.now(UTC) - timedelta(minutes=16)
    assert client.get("/admin/database/").status_code == 403
    with database.begin() as db:
        session = db.scalar(select(AdminSession))
        session.created_at = datetime.now(UTC)
        session.revoked = True
    assert client.get("/admin/database/").status_code == 401


def test_gerenciador_aceita_escrita_da_origem_do_front_sem_header_privado(
    owner, monkeypatch
):
    client = owner["client"]
    monkeypatch.setattr(settings, "cloudbeaver_enabled", True)
    monkeypatch.setattr(settings, "cors_origins", ["http://localhost:3000"])
    with respx.mock(assert_all_called=True) as remote:
        remote.post("http://127.0.0.1:8978/api/admin/database/api/gql").respond(
            200, json={"data": {"ok": True}}
        )
        response = client.post(
            "/admin/database/api/gql",
            json={"query": "synthetic"},
            headers={
                "Origin": "http://localhost:3000",
                "Sec-Fetch-Site": "same-origin",
            },
        )
        assert response.status_code == 200
        assert response.json() == {"data": {"ok": True}}


def test_gerenciador_recusa_visitante_sem_contatar_servico(client):
    assert client.get("/admin/database/").status_code == 401
    assert (
        client.post(
            "/admin/database/api/gql", headers={"Origin": "https://followw.app"}
        ).status_code
        == 401
    )


def test_gerenciador_somente_owner_sem_cookies_do_followw(roles, monkeypatch):
    client, cookies, _ = roles
    monkeypatch.setattr(settings, "cloudbeaver_enabled", True)
    for role in ("moderator", "administrator"):
        client.cookies.clear()
        client.cookies.update(cookies[role])
        assert client.get("/admin/database/").status_code == 403
    client.cookies.clear()
    client.cookies.update(cookies["owner"])
    client.cookies.set("cb-session-id", "sessao-cloudbeaver")

    def reply(request):
        assert request.headers.get("cookie") == "cb-session-id=sessao-cloudbeaver"
        assert "authorization" not in request.headers
        assert "x-admin-request" not in request.headers
        return httpx.Response(
            200,
            text="CloudBeaver",
            headers={"Set-Cookie": "cb-session-id=novo; Path=/; HttpOnly"},
        )

    with respx.mock(assert_all_called=True) as remote:
        remote.get("http://127.0.0.1:8978/api/admin/database/").mock(side_effect=reply)
        response = client.get(
            "/admin/database/", headers={"Authorization": "segredo-nao-repassar"}
        )
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert "Path=/api/admin/database/" in response.headers["set-cookie"]
    assert "SameSite=strict" in response.headers["set-cookie"]


def test_gerenciador_recusa_escrita_sem_origem_e_destino_externo(roles, monkeypatch):
    client, cookies, _ = roles
    monkeypatch.setattr(settings, "cloudbeaver_enabled", True)
    client.cookies.clear()
    client.cookies.update(cookies["owner"])
    assert client.post("/admin/database/api/gql").status_code == 403
    assert (
        client.post(
            "/admin/database/api/gql", headers={"Origin": "https://externo.invalid"}
        ).status_code
        == 403
    )
    with respx.mock(assert_all_called=True) as remote:
        remote.get("http://127.0.0.1:8978/api/admin/database/").respond(
            302, headers={"Location": "https://externo.invalid/"}
        )
        assert client.get("/admin/database/").status_code == 502


def test_gerenciador_desabilitado_ou_fora_do_ar_nao_expoe_erro_interno(
    roles, monkeypatch
):
    client, cookies, _ = roles
    client.cookies.clear()
    client.cookies.update(cookies["owner"])
    monkeypatch.setattr(settings, "cloudbeaver_enabled", False)
    assert client.get("/admin/database/").status_code == 503
    monkeypatch.setattr(settings, "cloudbeaver_enabled", True)
    with respx.mock(assert_all_called=True) as remote:
        remote.get("http://127.0.0.1:8978/api/admin/database/").mock(
            side_effect=httpx.ConnectError("teste")
        )
        assert client.get("/admin/database/").status_code == 503
