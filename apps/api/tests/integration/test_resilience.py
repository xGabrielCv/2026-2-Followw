import asyncio

import pytest

from api import resilience
from api.resilience import (
    CircuitBreaker,
    CircuitOpenError,
    OriginGuard,
    SingleFlight,
    backoff_delay,
    retry,
)


@pytest.fixture(autouse=True)
def limpar_contadores():
    resilience.reset_counters()


async def test_pedidos_simultaneos_iguais_viram_uma_unica_consulta():
    flights, calls = SingleFlight(), 0

    async def origem():
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.05)
        return "cardapio"

    results = await asyncio.gather(*[flights.run("ru:fga", origem) for _ in range(200)])
    assert results == ["cardapio"] * 200
    assert calls == 1
    assert resilience.counters()["single_flight.shared"] == 199


async def test_chaves_diferentes_nao_se_misturam_e_a_proxima_rodada_consulta_de_novo():
    flights, calls = SingleFlight(), []

    async def origem(name):
        calls.append(name)
        await asyncio.sleep(0.01)
        return name

    assert await asyncio.gather(
        flights.run("a", lambda: origem("a")), flights.run("b", lambda: origem("b"))
    ) == ["a", "b"]
    await flights.run("a", lambda: origem("a"))
    assert calls == ["a", "b", "a"]


async def test_erro_da_origem_chega_a_todos_e_nao_fica_preso():
    flights, calls = SingleFlight(), 0

    async def falha():
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.02)
        raise RuntimeError("origem fora do ar")

    outcomes = await asyncio.gather(
        *[flights.run("x", falha) for _ in range(20)], return_exceptions=True
    )
    assert all(isinstance(o, RuntimeError) for o in outcomes) and calls == 1

    async def volta():
        return "ok"

    assert await flights.run("x", volta) == "ok"


async def test_cancelar_um_pedido_nao_derruba_a_consulta_dos_outros():
    flights = SingleFlight()

    async def origem():
        await asyncio.sleep(0.05)
        return "ok"

    first = asyncio.create_task(flights.run("k", origem))
    second = asyncio.create_task(flights.run("k", origem))
    await asyncio.sleep(0.01)
    second.cancel()
    assert await first == "ok"


class Relogio:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


async def test_circuito_abre_apos_falhas_seguidas_e_testa_com_uma_consulta():
    clock = Relogio()
    breaker = CircuitBreaker(
        "teste", failure_threshold=3, reset_seconds=60, clock=clock
    )

    async def falha():
        raise ConnectionError

    for _ in range(3):
        with pytest.raises(ConnectionError):
            await breaker.call(falha)
    assert breaker.state == "open"
    with pytest.raises(CircuitOpenError):
        await breaker.call(falha)  # nem chega a consultar a origem

    clock.now = 61
    assert breaker.state == "half_open"
    assert breaker.allow() is True  # uma consulta de teste
    assert breaker.allow() is False  # as demais continuam barradas
    breaker.failure()  # o teste falhou: reabre
    assert breaker.state == "open"

    clock.now = 130

    async def ok():
        return 1

    assert await breaker.call(ok) == 1
    assert breaker.state == "closed"
    assert resilience.counters()["breaker.teste.opened"] == 1


async def test_sucesso_zera_a_contagem_de_falhas():
    breaker = CircuitBreaker("zera", failure_threshold=3)
    for _ in range(2):
        breaker.failure()
    breaker.success()
    breaker.failure()
    assert breaker.state == "closed"


def test_backoff_tem_jitter_e_respeita_o_teto():
    delays = [backoff_delay(10, base=1, cap=5) for _ in range(200)]
    assert max(delays) <= 5 and min(delays) < 4 and len(set(delays)) > 50
    assert backoff_delay(0, base=1, cap=30) <= 1


async def test_retentativas_param_no_limite_e_esperam_com_backoff():
    waits, calls = [], 0

    async def dormir(seconds):
        waits.append(seconds)

    async def instavel():
        nonlocal calls
        calls += 1
        if calls < 3:
            raise TimeoutError
        return "ok"

    assert (
        await retry(instavel, attempts=3, retry_on=(TimeoutError,), sleep=dormir)
        == "ok"
    )
    assert calls == 3 and len(waits) == 2

    calls = 0

    async def sempre_falha():
        nonlocal calls
        calls += 1
        raise TimeoutError

    with pytest.raises(TimeoutError):
        await retry(sempre_falha, attempts=2, retry_on=(TimeoutError,), sleep=dormir)
    assert calls == 2


async def test_guarda_da_origem_limita_consultas_simultaneas():
    guard = OriginGuard("limite", max_concurrent=2)
    active = peak = 0

    async def origem():
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.02)
        active -= 1
        return "ok"

    await asyncio.gather(*[guard.fetch(f"chave{i}", origem) for i in range(10)])
    assert peak == 2
    assert resilience.counters()["origin.limite.calls"] == 10


async def test_origem_fora_do_ar_deixa_de_ser_consultada_com_o_circuito_aberto():
    guard = OriginGuard(
        "queda", max_concurrent=4, failure_threshold=2, reset_seconds=60
    )
    calls = 0

    async def cai():
        nonlocal calls
        calls += 1
        raise ConnectionError

    for i in range(6):
        with pytest.raises((ConnectionError, CircuitOpenError)):
            await guard.fetch(f"k{i}", cai)
    assert calls == 2  # as outras quatro nem chegaram à origem


# ---- cardápio do RU: um campus, muitos alunos, uma consulta à UnB


def test_cardapio_do_ru_com_cache_vencido_consulta_a_unb_uma_vez(client, monkeypatch):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    from datetime import date

    from unb_browser import DailyMenu

    from api.modules.public_restaurant import service

    service.RESTAURANT_ORIGIN = OriginGuard("ru", max_concurrent=2)
    calls = []

    class Navegador:
        restaurant = None

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return None

    class Restaurante:
        async def get_menu(self, campus):
            calls.append(campus)
            await asyncio.sleep(0.2)
            return [DailyMenu(date=date.today())]

    browser = Navegador()
    browser.restaurant = Restaurante()
    monkeypatch.setattr(service, "UnbBrowser", lambda: browser)
    lock = threading.Barrier(8)

    def pedir(_):
        lock.wait()
        return client.get("/public/restaurant", params={"campus": "Darcy"}).status_code

    with ThreadPoolExecutor(8) as pool:
        codes = list(pool.map(pedir, range(8)))
    assert codes.count(200) >= 1 and len(calls) <= 2, (codes, calls)


# ---- cache compartilhado de dado público


async def test_cache_com_validade_consulta_a_origem_uma_vez_por_periodo():
    from api.resilience import TTLCache

    clock, calls = Relogio(), 0
    cache = TTLCache(ttl=60, stale_ttl=600, clock=clock)

    async def origem():
        nonlocal calls
        calls += 1
        return calls

    assert [await cache.get("k", origem) for _ in range(5)] == [1] * 5
    clock.now = 61
    assert await cache.get("k", origem) == 2
    assert (
        resilience.counters()["cache.hit"] == 4
        and resilience.counters()["cache.miss"] == 2
    )


async def test_cache_vencido_serve_se_a_origem_cair_e_para_de_servir_no_limite():
    from api.resilience import TTLCache

    clock = Relogio()
    cache = TTLCache(ttl=60, stale_ttl=600, clock=clock)

    async def boa():
        return "unidades"

    async def cai():
        raise ConnectionError

    assert await cache.get("k", boa) == "unidades"
    clock.now = 100  # vencido, dentro da tolerância
    assert await cache.get("k", cai) == "unidades"
    assert resilience.counters()["cache.stale_served"] == 1
    clock.now = 700  # além de ttl + stale_ttl: o erro aparece
    with pytest.raises(ConnectionError):
        await cache.get("k", cai)


async def test_cache_limita_o_numero_de_entradas():
    from api.resilience import TTLCache

    cache = TTLCache(ttl=60, max_entries=3)

    async def valor():
        return 1

    for i in range(10):
        await cache.get(f"k{i}", valor)
    assert len(cache._store) == 3


def test_unidades_do_sigaa_publico_saem_do_cache_e_filtram_localmente(
    client, monkeypatch
):
    from sigaa_client import Unit
    from sigaa_client.public.classrooms import PublicClassrooms

    calls = []

    async def lista(self, contains=None):
        calls.append(contains)
        return [
            Unit(id=1, name="FACULDADE DO GAMA"),
            Unit(id=2, name="Instituto de Física"),
        ]

    monkeypatch.setattr(PublicClassrooms, "list_units", lista)
    for _ in range(20):
        assert client.get("/public/classrooms/units").status_code == 200
    filtrado = client.get("/public/classrooms/units", params={"q": "fisica"}).json()
    assert [u["name"] for u in filtrado] == ["Instituto de Física"]
    assert calls == [None]  # uma única consulta ao SIGAA, sem filtro: o filtro é local


def test_unidades_vencidas_continuam_servindo_quando_o_sigaa_cai(client, monkeypatch):
    from sigaa_client import Unit
    from sigaa_client.public.classrooms import PublicClassrooms

    from api.modules.public_classrooms import service

    async def boa(self, contains=None):
        return [Unit(id=1, name="FACULDADE DO GAMA")]

    async def cai(self, contains=None):
        raise ConnectionError

    monkeypatch.setattr(PublicClassrooms, "list_units", boa)
    assert client.get("/public/classrooms/units").status_code == 200
    service.UNITS_CACHE._store = {
        k: (v, t - 7200) for k, (v, t) in service.UNITS_CACHE._store.items()
    }
    monkeypatch.setattr(PublicClassrooms, "list_units", cai)
    resposta = client.get("/public/classrooms/units")
    assert (
        resposta.status_code == 200
        and resposta.json()[0]["name"] == "FACULDADE DO GAMA"
    )


def test_busca_publica_de_turmas_repetida_consulta_o_sigaa_uma_vez(client, monkeypatch):
    from sigaa_client.public.classrooms import PublicClassrooms

    calls = []

    async def busca(self, unit, **kwargs):
        calls.append((unit, kwargs))
        return []

    monkeypatch.setattr(PublicClassrooms, "search", busca)
    params = {"unit": 673, "semester": "2026.2"}
    for _ in range(15):
        assert client.get("/public/classrooms", params=params).status_code == 200
    assert (
        client.get(
            "/public/classrooms", params={"unit": 673, "semester": "2026.1"}
        ).status_code
        == 200
    )
    assert calls == [
        (673, {"year": 2026, "period": 2}),
        (673, {"year": 2026, "period": 1}),
    ]


def test_busca_de_materias_sem_login_repetida_vem_do_json_pronto(
    client, database, monkeypatch
):
    from api.db.models import Subject
    from api.modules.public_subjects import router, service

    with database.begin() as session:
        session.add(Subject(code="FGA0003", name="CALCULO 1"))
    chamadas = []
    original = service.PublicSubjectService.search

    async def contando(self, *args, **kwargs):
        chamadas.append(args)
        return await original(self, *args, **kwargs)

    monkeypatch.setattr(service.PublicSubjectService, "search", contando)
    respostas = [
        client.get("/public/subjects", params={"q": "calculo"}) for _ in range(10)
    ]
    assert all(r.status_code == 200 for r in respostas)
    assert (
        len({r.text for r in respostas}) == 1
        and respostas[0].json()[0]["code"] == "FGA0003"
    )
    assert len(chamadas) == 1  # as outras nove saíram do cache
    assert respostas[0].headers["Cache-Control"] == "no-store"
    # erro não é cacheado: filtro inválido continua dando erro a cada pedido
    assert client.get("/public/subjects", params={"unit": "NAOEXISTE"}).status_code in {
        404,
        422,
    }
    assert router.SEARCH_RESPONSES._store
