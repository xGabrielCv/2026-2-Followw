"""Varredura opcional via daemon ClamAV (`clamd`) quando CLAMAV_HOST estiver configurado."""

import asyncio
import struct

from fastapi import HTTPException

from api.core.config import settings

_CHUNK = 64 * 1024
_TIMEOUT = 10.0


def enabled() -> bool:
    return bool(settings.clamav_host)


async def scan(data: bytes) -> None:
    """Envia os bytes para `clamd` via zINSTREAM quando configurado; rejeita se houver ameaça."""
    host = settings.clamav_host
    if not host:
        return
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, settings.clamav_port), timeout=_TIMEOUT
        )
    except OSError, TimeoutError:
        raise HTTPException(
            503, "Serviço de verificação de arquivos indisponível no momento."
        ) from None
    try:
        writer.write(b"zINSTREAM\0")
        for offset in range(0, len(data), _CHUNK):
            chunk = data[offset : offset + _CHUNK]
            writer.write(struct.pack("!I", len(chunk)) + chunk)
        writer.write(struct.pack("!I", 0))
        await asyncio.wait_for(writer.drain(), timeout=_TIMEOUT)
        reply = (
            (await asyncio.wait_for(reader.readuntil(b"\0"), timeout=_TIMEOUT))
            .rstrip(b"\0")
            .decode("utf-8", "replace")
        )
    except OSError, TimeoutError, asyncio.IncompleteReadError:
        raise HTTPException(
            503, "Falha na verificação de segurança do arquivo."
        ) from None
    finally:
        writer.close()
    if "FOUND" in reply:
        raise HTTPException(422, "Arquivo recusado pela verificação de segurança.")
    if not reply.endswith("OK"):
        raise HTTPException(503, "Resposta inesperada na verificação de arquivos.")
