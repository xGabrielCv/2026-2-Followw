"""Painel de sincronização: permissões, validação segura, execução manual e auditoria."""

import importlib.util
import pathlib
import time

import pytest

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


class Fonte:
    def __init__(self):
        self.chamadas = 0

    async def __call__(self, _settings):
        from api.modules.sync.service import Outcome

        self.chamadas += 1
        return Outcome("success", 7, f"resumo-{self.chamadas}")


@pytest.fixture
def agendador(client, monkeypatch, tmp_path):
    from api.db.main import get_sessionmaker
    from api.main import app
    from api.modules.sync import scheduler as modulo
    from api.modules.sync import sources

    monkeypatch.setattr(sources, "MARKER", tmp_path / "update.json")
    fonte = Fonte()
    sessionmaker = app.dependency_overrides[get_sessionmaker]()
    instancia = modulo.SyncScheduler(
        sessionmaker, executors={"catalog": fonte, "restaurant": fonte}
    )
    monkeypatch.setattr(modulo, "_scheduler", instancia)
    return fonte


def esperar(client, fonte, minimo, tentativas=100):
    for _ in range(tentativas):
        dados = client.get("/admin/api/sync", headers=HEADERS).json()
        if fonte.chamadas >= minimo and not any(s["running"] for s in dados["sources"]):
            return dados
        time.sleep(0.05)
    raise AssertionError("a sincronização manual não terminou")


@pytest.mark.parametrize(
    ("cargo", "esperado"),
    [("moderator", 403), ("administrator", 200), ("owner", 200)],
)
def test_visao_exige_operacoes(roles, agendador, cargo, esperado):
    client, cookies, _ = roles
    como(client, cookies[cargo])
    assert client.get("/admin/api/sync", headers=HEADERS).status_code == esperado


def test_sem_sessao_nao_ve_nada(roles, agendador):
    client, _, _ = roles
    client.cookies.clear()
    for caminho in (
        "/admin/api/sync",
        "/admin/api/sync/history",
        "/admin/api/sync/resources",
    ):
        assert client.get(caminho, headers=HEADERS).status_code in {401, 403}
    assert client.post("/admin/api/sync/catalog/run", headers=HEADERS).status_code in {
        401,
        403,
    }


def test_visao_mostra_padroes_e_so_as_fontes_conhecidas(roles, agendador):
    client, cookies, _ = roles
    como(client, cookies["administrator"])
    dados = client.get("/admin/api/sync", headers=HEADERS).json()
    assert dados["timezone"] == "America/Sao_Paulo"
    assert dados["settings"]["catalog_times"] == ["00:00", "08:00", "16:00"]
    assert dados["settings"]["restaurant_time"] == "06:00"
    assert [s["key"] for s in dados["sources"]] == ["catalog", "restaurant"]
    assert dados["history"] == []


def test_execucao_manual_responde_na_hora_e_aparece_no_historico(roles, agendador):
    client, cookies, _ = roles
    como(client, cookies["administrator"])
    resposta = client.post("/admin/api/sync/catalog/run", headers=HEADERS)
    assert resposta.status_code == 202
    assert resposta.json() == {"status": "started", "source": "catalog"}
    dados = esperar(client, agendador, 1)
    execucao = dados["history"][0]
    assert execucao["trigger"] == "manual" and execucao["status"] == "success"
    assert execucao["records"] == 7 and execucao["changed"] is True
    catalogo = dados["sources"][0]
    assert catalogo["last_success_at"] and catalogo["last_change_at"]
    assert catalogo["records"] == 7


def test_segunda_execucao_manual_logo_depois_e_recusada_por_pausa(roles, agendador):
    client, cookies, _ = roles
    como(client, cookies["administrator"])
    assert (
        client.post("/admin/api/sync/catalog/run", headers=HEADERS).status_code == 202
    )
    esperar(client, agendador, 1)
    resposta = client.post("/admin/api/sync/catalog/run", headers=HEADERS)
    assert resposta.status_code == 429
    assert agendador.chamadas == 1


@pytest.mark.parametrize("fonte", ["rm", "../etc/passwd", "catalog; ls", "sigaa"])
def test_fonte_desconhecida_e_recusada(roles, agendador, fonte):
    client, cookies, _ = roles
    como(client, cookies["owner"])
    assert client.post(f"/admin/api/sync/{fonte}/run", headers=HEADERS).status_code in {
        404,
        422,
    }
    assert agendador.chamadas == 0


def test_moderador_nao_executa_nem_configura(roles, agendador):
    client, cookies, _ = roles
    como(client, cookies["moderator"])
    assert (
        client.post("/admin/api/sync/catalog/run", headers=HEADERS).status_code == 403
    )
    assert (
        client.put("/admin/api/sync/settings", json={}, headers=HEADERS).status_code
        == 403
    )


def test_configuracao_valida_e_auditada(roles, agendador):
    client, cookies, _ = roles
    como(client, cookies["owner"])
    corpo = {"catalog_times": ["02:00", "10:30", "18:00"], "restaurant_time": "05:30"}
    resposta = client.put("/admin/api/sync/settings", json=corpo, headers=HEADERS)
    assert resposta.status_code == 200, resposta.text
    dados = client.get("/admin/api/sync", headers=HEADERS).json()
    assert dados["settings"]["catalog_times"] == ["02:00", "10:30", "18:00"]
    assert dados["sources"][0]["scheduled_times"] == ["02:00", "10:30", "18:00"]
    assert dados["sources"][0]["next_run_at"] is not None
    acoes = [
        a["action"]
        for a in client.get("/admin/api/log", headers=HEADERS).json()["items"]
    ]
    assert "sync.settings" in acoes


@pytest.mark.parametrize(
    "corpo",
    [
        {"catalog_times": ["24:00"]},
        {"catalog_times": ["08:00", "08:20"]},
        {"timeout_seconds": 5},
        {"timeout_seconds": 999999},
        {"backoff_minutes": 0},
        {"comando": "rm -rf /"},
        {"url": "http://exemplo.test"},
        {"catalog_enabled": "sim"},
    ],
)
def test_configuracao_fora_dos_limites_e_recusada(roles, agendador, corpo):
    client, cookies, _ = roles
    como(client, cookies["owner"])
    assert (
        client.put("/admin/api/sync/settings", json=corpo, headers=HEADERS).status_code
        == 422
    )
    atual = client.get("/admin/api/sync", headers=HEADERS).json()["settings"]
    assert atual["catalog_times"] == ["00:00", "08:00", "16:00"]


def test_recursos_da_comunidade_mostram_so_agregados(roles, agendador):
    client, cookies, _ = roles
    como(client, cookies["administrator"])
    itens = client.get("/admin/api/sync/resources", headers=HEADERS).json()
    assert {i["resource"] for i in itens} == {
        "forum",
        "materials",
        "reviews",
        "tutorials",
        "reports",
        "groups",
    }
    for item in itens:
        assert set(item) == {
            "resource",
            "label",
            "last_activity_hour",
            "last_24_hours",
            "total",
        }
        if item["last_activity_hour"]:
            assert item["last_activity_hour"][14:16] == "00"  # sem minutos


def test_historico_filtra_e_pagina(roles, agendador):
    client, cookies, _ = roles
    como(client, cookies["administrator"])
    client.post("/admin/api/sync/catalog/run", headers=HEADERS)
    esperar(client, agendador, 1)
    pagina = client.get(
        "/admin/api/sync/history?source=catalog&page_size=5", headers=HEADERS
    ).json()
    assert pagina["total"] == 1 and pagina["items"][0]["source"] == "catalog"
    assert (
        client.get("/admin/api/sync/history?source=restaurant", headers=HEADERS).json()[
            "total"
        ]
        == 0
    )
    assert (
        client.get("/admin/api/sync/history?status=hack", headers=HEADERS).status_code
        == 422
    )
    assert (
        client.get(
            "/admin/api/sync/history?page_size=1000", headers=HEADERS
        ).status_code
        == 422
    )


def test_arquivo_da_interface_e_servido_e_registrado(roles, agendador):
    client, _, _ = roles
    client.cookies.clear()
    resposta = client.get("/admin/assets/dashboard-sync.js")
    assert resposta.status_code == 200
    assert "javascript" in resposta.headers["content-type"]
    assert "syncView" in resposta.text
    assert "dashboard-sync.js" in client.get("/admin/assets/dashboard.js").text


def test_falha_da_auditoria_nao_inicia_coleta(roles, agendador, monkeypatch):
    from api.modules.admin import service, sync

    async def falhar(*args, **kwargs):
        raise RuntimeError("auditoria indisponivel")

    monkeypatch.setattr(service, "log", falhar)
    monkeypatch.setattr(sync, "log", falhar)
    client, cookies, _ = roles
    como(client, cookies["owner"])
    with pytest.raises(RuntimeError, match="auditoria indisponivel"):
        client.post("/admin/api/sync/catalog/run", headers=HEADERS)
    assert agendador.chamadas == 0


async def test_marca_de_exclusao_e_agregada_e_nao_amplia_escopo_rls(async_database):
    from sqlalchemy import text

    from api.db.context import apply_context, use_context
    from api.modules.community.activity import record_deletion

    with use_context(scope="community_write"):
        async with async_database() as session, session.begin():
            await apply_context(session)
            await record_deletion(session, "forum")
            assert (
                await session.scalar(text("SELECT current_setting('app.scope')"))
                == "community_write"
            )
            await session.execute(
                text("SELECT followw_record_public_activity('segredo')")
            )
            rows = (
                await session.execute(
                    text(
                        "SELECT key, value FROM system_texts WHERE key LIKE 'activity.%'"
                    )
                )
            ).all()
            assert len(rows) == 1 and rows[0][0] == "activity.forum"
            assert rows[0][1][14:19] == "00:00"
