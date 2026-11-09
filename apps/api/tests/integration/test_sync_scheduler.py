"""Agendador: concessão única entre processos, mudança por resumo, falha com espera e histórico."""

import asyncio
import json
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update

from api.db.context import use_context
from api.modules.sync.models import SyncRun, SyncState
from api.modules.sync.schedule import SyncSettings, next_run
from api.modules.sync.scheduler import SyncScheduler
from api.modules.sync.service import Outcome, save_settings


@pytest.fixture(autouse=True)
def sem_marca_do_script(tmp_path, monkeypatch):
    """O teste não depende da marca de atualização desta máquina."""
    from api.modules.sync import sources

    monkeypatch.setattr(sources, "MARKER", tmp_path / "update.json")


class Fonte:
    """Executor falso: conta chamadas e devolve o que o teste mandar."""

    def __init__(self, *resultados):
        self.resultados = list(resultados)
        self.chamadas = 0
        self.espera = None

    async def __call__(self, _settings):
        self.chamadas += 1
        if self.espera:
            await self.espera.wait()
        return (
            self.resultados.pop(0) if len(self.resultados) > 1 else self.resultados[0]
        )


def agendador(sessionmaker, catalogo, restaurante=None):
    return SyncScheduler(
        sessionmaker,
        executors={
            "catalog": catalogo,
            "restaurant": restaurante or Fonte(Outcome("success", 1, "r")),
        },
    )


async def estado(sessionmaker, fonte="catalog"):
    with use_context(scope="sync"):
        async with sessionmaker() as session:
            await session.connection()
            from api.db.context import apply_context

            await apply_context(session)
            return await session.get(SyncState, fonte)


async def aguardar(agendador):
    while agendador.running():
        await asyncio.sleep(0.01)


async def execucoes(sessionmaker, fonte="catalog"):
    from api.db.context import apply_context

    with use_context(scope="sync"):
        async with sessionmaker() as session:
            await apply_context(session)
            return list(
                await session.scalars(
                    select(SyncRun)
                    .where(SyncRun.source == fonte)
                    .order_by(SyncRun.started_at)
                )
            )


async def configurar(sessionmaker, **campos):
    from api.db.context import apply_context

    with use_context(scope="admin"):
        async with sessionmaker() as session, session.begin():
            await apply_context(session)
            await save_settings(session, SyncSettings(**campos))


async def alterar(sessionmaker, fonte="catalog", **valores):
    from api.db.context import apply_context

    with use_context(scope="sync"):
        async with sessionmaker() as session, session.begin():
            await apply_context(session)
            await session.execute(
                update(SyncState).where(SyncState.source == fonte).values(**valores)
            )


async def test_primeira_subida_sincroniza_uma_vez_e_agenda_o_proximo_horario(
    async_database,
):
    fonte = Fonte(Outcome("success", 120, "abc"))
    s = agendador(async_database, fonte)
    assert "catalog" in await s.tick()
    await aguardar(s)
    assert fonte.chamadas == 1
    atual = await estado(async_database)
    assert atual.last_status == "success"
    assert atual.records == 120
    assert atual.last_change_at is not None
    assert atual.next_run_at > datetime.now(UTC)
    assert atual.next_run_at == next_run(
        datetime.now(UTC), SyncSettings().catalog_times
    )
    # nada vence de novo logo em seguida
    assert await s.tick() == []
    assert fonte.chamadas == 1


async def test_reinicio_recente_nao_repete_a_sincronizacao(async_database):
    primeira = Fonte(Outcome("success", 1, "abc"))
    s = agendador(async_database, primeira)
    await s.tick()
    await aguardar(s)
    # processo novo, mesmo banco: o último sucesso é recente, então só espera o próximo horário
    segunda = Fonte(Outcome("success", 1, "abc"))
    s2 = agendador(async_database, segunda)
    await alterar(async_database, next_run_at=None)
    assert "catalog" not in await s2.tick()
    assert segunda.chamadas == 0


async def test_reinicio_depois_do_limite_sincroniza_na_subida(async_database):
    s = agendador(async_database, Fonte(Outcome("success", 1, "abc")))
    await s.tick()
    await aguardar(s)
    await alterar(
        async_database,
        next_run_at=None,
        last_success_at=datetime.now(UTC) - timedelta(hours=9),
    )
    novo = Fonte(Outcome("success", 1, "abc"))
    assert "catalog" in await agendador(async_database, novo).tick()


async def test_so_um_processo_executa_cada_vencimento(async_database):
    fonte = Fonte(Outcome("success", 1, "abc"))
    fonte.espera = asyncio.Event()
    processos = [agendador(async_database, fonte) for _ in range(6)]
    iniciados = await asyncio.gather(*(p.tick() for p in processos))
    assert sum("catalog" in i for i in iniciados) == 1
    fonte.espera.set()
    await asyncio.gather(*(aguardar(p) for p in processos))
    assert fonte.chamadas == 1
    assert len(await execucoes(async_database)) == 1


async def test_concessao_vencida_de_processo_morto_e_retomada(async_database):
    fonte = Fonte(Outcome("success", 1, "abc"))
    s = agendador(async_database, fonte)
    await s.tick()
    await aguardar(s)
    await alterar(
        async_database,
        next_run_at=datetime.now(UTC) - timedelta(minutes=1),
        lease_until=datetime.now(UTC) + timedelta(minutes=30),
        lease_owner="morto",
    )
    assert (
        await agendador(async_database, fonte).tick() == []
    )  # ainda dentro da concessão
    await alterar(async_database, lease_until=datetime.now(UTC) - timedelta(seconds=1))
    assert "catalog" in await agendador(async_database, fonte).tick()


async def test_sem_mudanca_registra_inalterado_e_nao_mexe_na_data_de_mudanca(
    async_database,
):
    fonte = Fonte(Outcome("success", 10, "igual"))
    s = agendador(async_database, fonte)
    await s.tick()
    await aguardar(s)
    primeira_mudanca = (await estado(async_database)).last_change_at
    await alterar(async_database, next_run_at=datetime.now(UTC) - timedelta(seconds=1))
    await s.tick()
    await aguardar(s)
    atual = await estado(async_database)
    assert atual.last_status == "unchanged"
    assert atual.last_change_at == primeira_mudanca
    assert [r.status for r in await execucoes(async_database)] == [
        "success",
        "unchanged",
    ]


async def test_falha_mantem_o_ultimo_dado_e_espera_cada_vez_mais(
    async_database, monkeypatch
):
    # próximo horário fixo e distante: só a espera por falha aparece
    monkeypatch.setattr(
        "api.modules.sync.service.next_run",
        lambda agora, _horarios: agora + timedelta(hours=8),
    )
    fonte = Fonte(Outcome("success", 10, "ok"), Outcome("failed", error="fora do ar"))
    s = agendador(async_database, fonte)
    await s.tick()
    await aguardar(s)
    valido = await estado(async_database)
    esperas = []
    for _ in range(3):
        await alterar(
            async_database, next_run_at=datetime.now(UTC) - timedelta(seconds=1)
        )
        await s.tick()
        await aguardar(s)
        atual = await estado(async_database)
        esperas.append(atual.next_run_at - datetime.now(UTC))
    assert atual.last_status == "failed"
    assert atual.consecutive_failures == 3
    # dado válido anterior permanece
    assert atual.fingerprint == valido.fingerprint
    assert atual.records == 10
    assert atual.last_success_at == valido.last_success_at
    assert [round(e.total_seconds() / 60) for e in esperas] == [15, 30, 60]
    assert all(e <= timedelta(hours=6) for e in esperas)
    # uma volta ao normal zera as falhas
    fonte.resultados = [Outcome("success", 11, "novo")]
    await alterar(async_database, next_run_at=datetime.now(UTC) - timedelta(seconds=1))
    await s.tick()
    await aguardar(s)
    assert (await estado(async_database)).consecutive_failures == 0


async def test_excecao_do_executor_vira_falha_registrada(async_database):
    class Quebra:
        async def __call__(self, _settings):
            raise RuntimeError("segredo-interno")

    s = agendador(async_database, Quebra())
    await s.tick()
    await aguardar(s)
    execucao = (await execucoes(async_database))[0]
    assert execucao.status == "failed"
    assert execucao.error == "Erro interno: RuntimeError"
    assert "segredo" not in execucao.error


async def test_fonte_desligada_nao_roda(async_database):
    await configurar(async_database, catalog_enabled=False)
    fonte = Fonte(Outcome("success", 1, "x"))
    assert "catalog" not in await agendador(async_database, fonte).tick()
    assert fonte.chamadas == 0


async def test_manual_roda_em_segundo_plano_respeita_pausa_e_nao_roda_em_paralelo(
    async_database,
):
    fonte = Fonte(Outcome("success", 1, "m"))
    fonte.espera = asyncio.Event()
    s = agendador(async_database, fonte)
    assert await s.trigger("catalog") == "started"
    assert await s.trigger("catalog") == "busy"
    fonte.espera.set()
    await aguardar(s)
    assert await s.trigger("catalog") == "cooldown"
    execucao = (await execucoes(async_database))[0]
    assert execucao.trigger == "manual"
    with pytest.raises(ValueError, match="desconhecida"):
        await s.trigger("rm -rf")


async def test_manual_nao_adianta_nem_cancela_o_proximo_horario(async_database):
    s = agendador(async_database, Fonte(Outcome("success", 1, "a")))
    await s.tick()
    await aguardar(s)
    agendado = (await estado(async_database)).next_run_at
    await alterar(
        async_database, last_attempt_at=datetime.now(UTC) - timedelta(hours=1)
    )
    assert await s.trigger("catalog") == "started"
    await aguardar(s)
    assert (await estado(async_database)).next_run_at == agendado


async def test_historico_guarda_so_o_limite(async_database):
    await configurar(async_database, history_limit=50)
    s = agendador(async_database, Fonte(Outcome("success", 1, "h")))
    for _ in range(55):
        await s.tick()
        await aguardar(s)
        await alterar(
            async_database, next_run_at=datetime.now(UTC) - timedelta(seconds=1)
        )
    assert len(await execucoes(async_database)) == 50


async def test_cardapio_tem_estado_proprio_e_horario_das_6h(async_database):
    restaurante = Fonte(Outcome("success", 35, "r"))
    s = agendador(async_database, Fonte(Outcome("success", 1, "c")), restaurante)
    await s.tick()
    await aguardar(s)
    atual = await estado(async_database, "restaurant")
    assert atual.records == 35
    assert atual.next_run_at == next_run(datetime.now(UTC), ["06:00"])


async def test_aplicacao_nao_le_estado_fora_do_escopo(async_database):
    s = agendador(async_database, Fonte(Outcome("success", 1, "x")))
    await s.tick()
    await aguardar(s)
    async with async_database() as session:
        assert list(await session.scalars(select(SyncState))) == []
        assert list(await session.scalars(select(SyncRun))) == []


async def test_marca_recente_do_script_evita_repetir_na_subida(
    async_database, tmp_path, monkeypatch
):
    from api.modules.sync import sources

    marca = tmp_path / "update.json"
    recente = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    marca.write_text(json.dumps({"updated_at": recente}), encoding="utf-8")
    monkeypatch.setattr(sources, "MARKER", marca)
    fonte = Fonte(Outcome("success", 1, "x"))
    assert "catalog" not in await agendador(async_database, fonte).tick()
    assert fonte.chamadas == 0
    # marca antiga: sincroniza
    marca.write_text('{"updated_at": "2020-01-01T00:00:00+00:00"}', encoding="utf-8")
    await alterar(async_database, next_run_at=None)
    assert "catalog" in await agendador(async_database, fonte).tick()


async def test_manual_na_primeira_vez_nao_deixa_o_agendador_repetir_em_seguida(
    async_database,
):
    fonte = Fonte(Outcome("success", 1, "m"))
    s = agendador(async_database, fonte)
    assert await s.trigger("catalog") == "started"
    await aguardar(s)
    assert (await estado(async_database)).next_run_at > datetime.now(UTC)
    assert "catalog" not in await s.tick()
    assert fonte.chamadas == 1
