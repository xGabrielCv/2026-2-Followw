"""Guarda de socket exclusiva dos servidores sintéticos, instalada antes de subir a API."""

import asyncio
import ipaddress
import socket
from collections.abc import Callable


class EgressBlocked(OSError):
    pass


def install(on_block: Callable[[], None] = lambda: None) -> None:
    def guard(address) -> None:
        if not isinstance(address, tuple):
            return  # Sockets locais Unix não saem pela rede.
        host = address[0]
        if host in ("localhost", b"localhost"):
            return
        try:
            if ipaddress.ip_address(host).is_loopback:
                return
        except ValueError:
            pass
        on_block()
        raise EgressBlocked("Saída não local bloqueada no ambiente sintético.")

    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex
    original_sendto = socket.socket.sendto
    original_getaddrinfo = socket.getaddrinfo
    original_create_connection = asyncio.BaseEventLoop.create_connection

    def connect(self, address):
        guard(address)
        return original_connect(self, address)

    def connect_ex(self, address):
        guard(address)
        return original_connect_ex(self, address)

    def sendto(self, data, *args):
        guard(args[-1])
        return original_sendto(self, data, *args)

    def getaddrinfo(host, port, *args, **kwargs):
        guard((host, port))
        return original_getaddrinfo(host, port, *args, **kwargs)

    async def create_connection(self, protocol_factory, host=None, port=None, **kwargs):
        if host is not None:
            guard((host, port))
        elif kwargs.get("sock"):
            guard(kwargs["sock"].getpeername())
        return await original_create_connection(
            self, protocol_factory, host, port, **kwargs
        )

    socket.socket.connect = connect
    socket.socket.connect_ex = connect_ex
    socket.socket.sendto = sendto
    socket.getaddrinfo = getaddrinfo
    asyncio.BaseEventLoop.create_connection = create_connection


def canary() -> bool:
    """Destino reservado para documentação: a guarda precisa recusar antes de abrir conexão."""
    try:
        with socket.socket() as probe:
            probe.connect(("192.0.2.1", 443))
    except EgressBlocked:
        return True
    return False


async def async_canary() -> bool:
    """Cobre também ConnectEx do Proactor no Windows, que não chama socket.connect."""
    try:
        async with asyncio.timeout(0.5):
            _, writer = await asyncio.open_connection("192.0.2.1", 443)
            writer.close()
            await writer.wait_closed()
    except EgressBlocked:
        return True
    except OSError, TimeoutError:
        return False
    return False
