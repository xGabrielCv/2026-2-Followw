"""Registros técnicos: o que é gravado, quem lê, filtros seguros e retenção."""

import importlib.util
import logging
import pathlib
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from api.db.context import apply_context, use_context
from api.modules.logs.models import AppEvent
from api.modules.logs.sink import EventSink, clean, wanted

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


def test_so_eventos_relevantes_sao_gravados():
    assert wanted(logging.WARNING, "qualquer.coisa", {})
    assert wanted(logging.ERROR, "request.failed", {})
    assert wanted(logging.INFO, "sync.finish", {})
    assert wanted(logging.INFO, "request.completed", {"status_code": 503})
    assert not wanted(logging.INFO, "request.completed", {"status_code": 200})
    assert not wanted(logging.INFO, "request.started", {})


def test_campos_sensiveis_e_complexos_nunca_passam():
    limpo = clean(
        {
            "route": "/me",
            "password": "x",
            "access_token": "x",
            "cookie_value": "x",
            "registration": "251000000",
            "user_email": "a@b",
            "request_body": "x",
            "dados": {"a": 1},
            "lista": [1],
            "status_code": 500,
            "texto": "a" * 500,
        }
    )
    assert set(limpo) == {"route", "status_code"}


def test_lista_fechada_recusa_dados_disfarcados_de_metadados():
    assert (
        clean(
            {
                "message": "251000000",
                "route": "/me?password=senha",
                "error_type": "a@b.com",
                "source": "https://example.com",
                "duration_ms": float("nan"),
            }
        )
        == {}
    )
    assert clean(
        {
            "route": "/public/subjects/{code}",
            "error_type": "TimeoutError",
            "duration_ms": 12.5,
        }
    ) == {
        "route": "/public/subjects/{code}",
        "error_type": "TimeoutError",
        "duration_ms": 12.5,
    }


def test_fila_cheia_descarta_o_mais_antigo_sem_levantar_erro():
    sink = EventSink(None, max_queue=3)
    for numero in range(5):
        sink.offer(logging.WARNING, f"e{numero}", {})
    assert [e.event for e in sink._queue] == ["e2", "e3", "e4"]
    assert sink.dropped == 2
    sink.offer(logging.WARNING, "x", {"campo": object()})  # nunca levanta


async def ler(sessionmaker, escopo="admin"):
    with use_context(scope=escopo):
        async with sessionmaker() as session:
            await apply_context(session)
            return list(await session.scalars(select(AppEvent).order_by(AppEvent.at)))


async def test_gravacao_em_lote_com_escopo_e_sem_leitura_fora_dele(async_database):
    sink = EventSink(async_database)
    sink.offer(logging.WARNING, "origem.fora", {"route": "/x", "password": "segredo"})
    sink.offer(logging.INFO, "request.started", {})
    assert await sink.flush() == 1
    (evento,) = await ler(async_database)
    assert evento.event == "origem.fora" and evento.fields == {"route": "/x"}
    # a aplicação sem escopo administrativo não enxerga os eventos
    async with async_database() as session:
        assert list(await session.scalars(select(AppEvent))) == []


async def test_retencao_apaga_so_o_antigo(async_database):
    sink = EventSink(async_database, retention_days=7)
    with use_context(scope="logs"):
        async with async_database() as session, session.begin():
            await apply_context(session)
            agora = datetime.now(UTC)
            session.add_all(
                [
                    AppEvent(
                        at=agora - timedelta(days=30),
                        level="ERROR",
                        event="velho",
                        fields={},
                    ),
                    AppEvent(
                        at=agora - timedelta(days=1),
                        level="ERROR",
                        event="novo",
                        fields={},
                    ),
                ]
            )
    await sink.purge()
    assert [e.event for e in await ler(async_database)] == ["novo"]


async def test_falha_ao_gravar_nao_gera_laco_nem_levanta(async_database):
    class Quebrado:
        def __call__(self):
            raise RuntimeError("banco fora")

    sink = EventSink(Quebrado())
    sink.offer(logging.ERROR, "a", {})
    assert await sink.flush() == 0
    assert sink.dropped == 1
    assert not sink._queue


@pytest.fixture
def com_eventos(client, database):
    """Eventos já gravados (como o gravador faria), inseridos pelo dono do banco de teste."""
    agora = datetime.now(UTC)
    linhas = (
        ("sync.finish", "INFO", {"source": "catalog", "outcome": "success"}),
        ("sync.finish", "INFO", {"source": "restaurant", "outcome": "failed"}),
        ("request.failed", "ERROR", {"route": "/me", "error_type": "TimeoutError"}),
        ("origem.lenta", "WARNING", {"route": "/a_b", "duration_ms": 900}),
        ("origem.lenta", "WARNING", {"route": "/aXb", "duration_ms": 1}),
    )
    with database.begin() as session:
        for indice, (nome, nivel, campos) in enumerate(linhas):
            session.add(
                AppEvent(
                    at=agora - timedelta(minutes=indice),
                    level=nivel,
                    event=nome,
                    fields=campos,
                )
            )


@pytest.mark.parametrize(
    ("cargo", "esperado"),
    [("moderator", 403), ("administrator", 200), ("owner", 200)],
)
def test_leitura_exige_permissao_de_auditoria(roles, com_eventos, cargo, esperado):
    client, cookies, _ = roles
    como(client, cookies[cargo])
    assert client.get("/admin/api/logs", headers=HEADERS).status_code == esperado
    assert (
        client.get("/admin/api/logs/summary", headers=HEADERS).status_code == esperado
    )


def test_sem_sessao_nao_le(roles, com_eventos):
    client, _, _ = roles
    client.cookies.clear()
    assert client.get("/admin/api/logs", headers=HEADERS).status_code in {401, 403}


def test_filtros_por_nivel_evento_e_busca(roles, com_eventos):
    client, cookies, _ = roles
    como(client, cookies["administrator"])

    def buscar(**params):
        resposta = client.get("/admin/api/logs", params=params, headers=HEADERS)
        assert resposta.status_code == 200, resposta.text
        return resposta.json()

    assert buscar()["total"] == 5
    assert buscar(level="ERROR")["total"] == 1
    assert buscar(event="sync.")["total"] == 2
    assert buscar(q="restaurant")["total"] == 1
    assert buscar(q="TimeoutError")["items"][0]["event"] == "request.failed"
    # curingas do LIKE são tratados como texto: "_" não casa "X"
    assert buscar(q="/a_b")["total"] == 1
    assert buscar(q="%")["total"] == 0
    futuro = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
    assert buscar(since=futuro)["total"] == 0


def test_paginacao_e_limites(roles, com_eventos):
    client, cookies, _ = roles
    como(client, cookies["owner"])
    pagina = client.get("/admin/api/logs?page_size=2&page=3", headers=HEADERS).json()
    assert pagina["total"] == 5 and len(pagina["items"]) == 1
    for invalido in (
        "page_size=101",
        "page=0",
        "level=DEBUG",
        "event=../etc/passwd",
        "event=a b",
        "q=",
    ):
        assert (
            client.get(f"/admin/api/logs?{invalido}", headers=HEADERS).status_code
            == 422
        )


def test_resumo_conta_por_nivel(roles, com_eventos):
    client, cookies, _ = roles
    como(client, cookies["administrator"])
    resumo = client.get("/admin/api/logs/summary", headers=HEADERS).json()
    assert resumo["last_24_hours"] == {"INFO": 2, "ERROR": 1, "WARNING": 2}
    assert resumo["retention_days"] == 14


def test_painel_nao_expoe_arquivo_nem_caminho(roles, com_eventos):
    client, cookies, _ = roles
    como(client, cookies["owner"])
    for caminho in (
        "/admin/api/logs/..%2F..%2F.env",
        "/admin/api/logs/file",
        "/admin/api/logs/download",
    ):
        assert client.get(caminho, headers=HEADERS).status_code in {404, 405, 422}
    texto = client.get("/admin/api/logs", headers=HEADERS).text
    assert "password" not in texto and "cookie" not in texto.lower()


def test_interface_e_servida(roles, com_eventos):
    client, _, _ = roles
    client.cookies.clear()
    assert "logsView" in client.get("/admin/assets/dashboard-logs.js").text
