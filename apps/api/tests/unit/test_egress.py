import asyncio
import socket

import pytest

from loadtest.egress import EgressBlocked, async_canary, canary, install


def test_guarda_recusa_tcp_dns_e_udp_antes_de_sair_da_maquina(monkeypatch):
    for target, name in [
        (socket.socket, "connect"),
        (socket.socket, "connect_ex"),
        (socket.socket, "sendto"),
        (socket, "getaddrinfo"),
        (asyncio.BaseEventLoop, "create_connection"),
    ]:
        monkeypatch.setattr(target, name, getattr(target, name))
    attempts = []
    install(lambda: attempts.append(1))
    assert canary()
    with pytest.raises(EgressBlocked):
        socket.getaddrinfo("sigaa.unb.br", 443)
    with socket.socket() as probe, pytest.raises(EgressBlocked):
        probe.connect_ex(("192.0.2.1", 443))
    with (
        socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe,
        pytest.raises(EgressBlocked),
    ):
        probe.sendto(b"canary", ("192.0.2.1", 53))
    assert len(attempts) == 4
    assert socket.getaddrinfo("127.0.0.1", 5432)


async def test_guarda_bloqueia_conexao_assincrona_antes_do_proactor(monkeypatch):
    for target, name in [
        (socket.socket, "connect"),
        (socket.socket, "connect_ex"),
        (socket.socket, "sendto"),
        (socket, "getaddrinfo"),
        (asyncio.BaseEventLoop, "create_connection"),
    ]:
        monkeypatch.setattr(target, name, getattr(target, name))
    install()
    assert await async_canary()
