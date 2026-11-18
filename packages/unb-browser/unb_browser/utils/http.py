"""Leitura de páginas e arquivos dos sites da UnB."""

import httpx
from bs4 import BeautifulSoup

from ..exceptions import UnbParseError

_MAX_FILE_BYTES = 15 * 1024 * 1024


async def fetch_page(http: httpx.AsyncClient, url: str) -> BeautifulSoup:
    response = await http.get(url)
    response.raise_for_status()
    return BeautifulSoup(response.text, "lxml")


async def fetch_file(http: httpx.AsyncClient, url: str) -> bytes:
    chunks = bytearray()
    async with http.stream("GET", url) as response:
        response.raise_for_status()
        async for chunk in response.aiter_bytes():
            chunks.extend(chunk)
            if len(chunks) > _MAX_FILE_BYTES:
                raise UnbParseError("Arquivo público da UnB excede o limite esperado.")
    return bytes(chunks)
