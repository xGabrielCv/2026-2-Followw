import ssl
from functools import lru_cache
from typing import Self

import httpx

from .calendar import Calendar
from .config import DEFAULT_TIMEOUT, USER_AGENT
from .restaurant import Restaurant


@lru_cache(maxsize=1)
def _default_ssl_context() -> ssl.SSLContext:
    return httpx.create_ssl_context()


class UnbBrowser:
    """Client dos sites públicos da UnB — cada site é um resource."""

    def __init__(
        self,
        timeout: float = DEFAULT_TIMEOUT,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._http = httpx.AsyncClient(
            headers={"User-Agent": USER_AGENT},
            follow_redirects=True,
            timeout=timeout,
            transport=transport,
            verify=_default_ssl_context() if transport is None else True,
        )
        self.restaurant = Restaurant(self._http)
        self.calendar = Calendar(self._http)

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._http.aclose()
