"""App de teste de carga: a API real com a UnB simulada (latência e contagem de consultas).

Só o ambiente de carga importa este módulo; produção usa `api.main:app`. Nunca consulta o SIGAA.
"""

import asyncio
import os
from datetime import date, timedelta
from pathlib import Path

import httpx
from unb_browser import DailyMenu

from api.main import app
from api.modules.public_restaurant import service

_LOG = Path(os.environ["LOAD_ORIGIN_LOG"])
_LATENCY = float(os.environ.get("LOAD_ORIGIN_LATENCY", "0.4"))


class _Restaurant:
    async def get_menu(self, campus):
        with _LOG.open("ab") as handle:  # noqa: ASYNC230 — um byte por consulta, somado entre os workers
            handle.write(b"x")
        await asyncio.sleep(_LATENCY)
        monday = date.today() - timedelta(days=date.today().weekday())
        return [DailyMenu(date=monday + timedelta(days=i)) for i in range(7)]


class _Browser:
    restaurant = _Restaurant()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return None


service.UnbBrowser = lambda: _Browser()

# ---- Guarda de saída: nenhuma requisição HTTP deste processo sai para fora do próprio computador.
# Camada extra além do proxy inexistente: o transporte do httpx (usado pelo cliente do SIGAA, pelo da
# UnB e por qualquer biblioteca da API) recusa qualquer destino que não seja loopback e conta a tentativa.
_BLOCKED = Path(os.environ["LOAD_ORIGIN_LOG"] + ".blocked")
_LOCAL = {"127.0.0.1", "localhost", "::1", "testserver"}


class EgressBlocked(httpx.TransportError):
    """Tentativa de sair para um destino externo durante o teste de carga."""


def _guard(request: httpx.Request) -> None:
    if request.url.host not in _LOCAL:
        with _BLOCKED.open("ab") as handle:
            handle.write(b"x")
        raise EgressBlocked(
            f"saída externa bloqueada no teste de carga: {request.url.host}"
        )


_async_send = httpx.AsyncHTTPTransport.handle_async_request
_sync_send = httpx.HTTPTransport.handle_request


async def _guarded_async(self, request):
    _guard(request)
    return await _async_send(self, request)


def _guarded_sync(self, request):
    _guard(request)
    return _sync_send(self, request)


httpx.AsyncHTTPTransport.handle_async_request = _guarded_async
httpx.HTTPTransport.handle_request = _guarded_sync

# SIGAA público simulado: a lista de unidades da busca de turmas (200+ itens, com latência de rede).
from sigaa_client import Unit
from sigaa_client.public.classrooms import PublicClassrooms

_SIGAA_LOG = Path(os.environ["LOAD_ORIGIN_LOG"] + ".sigaa")


async def _fake_list_units(self, contains=None):
    with _SIGAA_LOG.open("ab") as handle:  # noqa: ASYNC230
        handle.write(b"x")
    await asyncio.sleep(_LATENCY)
    return [Unit(id=1000 + i, name=f"UNIDADE SIMULADA {i:03d}") for i in range(230)]


PublicClassrooms.list_units = _fake_list_units


@app.get("/__loadtest/origin_calls", include_in_schema=False)
async def origin_calls() -> dict[str, int]:
    return {
        "ru": _LOG.stat().st_size if _LOG.exists() else 0,
        "sigaa_units": _SIGAA_LOG.stat().st_size if _SIGAA_LOG.exists() else 0,
    }


@app.get("/__loadtest/egress_check", include_in_schema=False)
async def egress_check() -> dict[str, bool]:
    """Tenta sair para um destino externo: precisa falhar ANTES de qualquer conexão."""
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            await client.get("https://sigaa.unb.br/")
    except EgressBlocked:
        return {"blocked": True}
    except Exception:  # noqa: BLE001 — qualquer outra falha não prova o bloqueio
        return {"blocked": False}
    return {"blocked": False}


@app.get("/__loadtest/blocked", include_in_schema=False)
async def blocked_attempts() -> dict[str, int]:
    return {"attempts": _BLOCKED.stat().st_size if _BLOCKED.exists() else 0}
