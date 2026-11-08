import asyncio
from collections.abc import AsyncGenerator
from contextlib import suppress
from typing import Annotated
from weakref import WeakValueDictionary

import httpx
from fastapi import Depends, HTTPException, Request, Response, status
from sigaa_client import Credentials, SigaaClient, SigaaError, SigaaPublicClient

from api.cookies import (
    read_access_cookie,
    read_refresh_cookie,
    set_access_cookie,
    set_refresh_cookie,
)
from api.logger import event, operation

# O SIGAA guarda na sessão a turma aberta: duas requisições do mesmo aluno ao mesmo tempo
# misturariam as telas. Cada aluno usa a sessão uma requisição por vez.
_SESSION_LOCKS: WeakValueDictionary[str, asyncio.Lock] = WeakValueDictionary()
# Uma requisição presa não segura as outras para sempre.
_LOCK_TIMEOUT = 90


class SigaaConnection:
    """Abre um único `SigaaClient`, e só quando alguém precisa do SIGAA.

    Sem `session_token`, abrir o client já loga. Com `response`, é a conexão da
    requisição: abrir o client renova os cookies. Quem cria a conexão a fecha.
    """

    def __init__(
        self,
        credentials: Credentials,
        session_token: str | None = None,
        *,
        response: Response | None = None,
    ) -> None:
        self.credentials = credentials
        self._session_token = session_token
        self._response = response
        self._client: SigaaClient | None = None
        self._lock: asyncio.Lock | None = None

    @property
    def registration(self) -> str:
        return self.credentials.registration

    @property
    def authenticated(self) -> bool:
        """Há um access_token, lido do cookie ou criado nesta conexão."""
        return self._session_token is not None

    async def client(self) -> SigaaClient:
        if self._client is None:
            await self._acquire()
            client = SigaaClient(
                credentials=self.credentials,
                session_token=self._session_token,
                on_session_renewed=self._renew,
            )
            try:
                with operation("sigaa.connect", reused_session=self.authenticated):
                    token = self._session_token or await client.authenticate()
            except BaseException:
                await client.aclose()
                self._release()
                raise
            self._client = client
            self._renew(token)
        return self._client

    async def aclose(self, *, logout: bool = False) -> None:
        """Fecha o client; com `logout`, encerra antes a sessão no SIGAA."""
        client, self._client = self._client, None
        if client is None:
            return
        try:
            if logout:
                with suppress(SigaaError, httpx.HTTPError), operation("sigaa.logout"):
                    await client.logout()
        finally:
            await client.aclose()
            self._release()

    async def _acquire(self) -> None:
        # Só a sessão do navegador é compartilhada; os jobs logam numa sessão própria.
        if self._response is None or self._lock is not None:
            return
        lock = _SESSION_LOCKS.get(self.registration)
        if lock is None:
            lock = _SESSION_LOCKS[self.registration] = asyncio.Lock()
        try:
            await asyncio.wait_for(lock.acquire(), _LOCK_TIMEOUT)
        except TimeoutError:
            event("sigaa.session_lock_timeout")
            return
        self._lock = lock

    def _release(self) -> None:
        lock, self._lock = self._lock, None
        if lock is not None and lock.locked():
            lock.release()

    def _renew(self, token: str) -> None:
        self._session_token = token
        # Se a chamada ao SIGAA falhar, o handler do erro descarta estes cookies.
        if self._response is not None:
            set_refresh_cookie(self._response, self.credentials)
            set_access_cookie(self._response, token, self.registration)


async def get_optional_sigaa_connection(
    request: Request, response: Response
) -> AsyncGenerator[SigaaConnection | None]:
    credentials = read_refresh_cookie(request)
    if credentials is None:
        yield None
        return

    connection = SigaaConnection(
        credentials,
        read_access_cookie(request, credentials.registration),
        response=response,
    )
    try:
        yield connection
    finally:
        await connection.aclose()


OptionalSigaaConnectionDep = Annotated[
    SigaaConnection | None, Depends(get_optional_sigaa_connection)
]


async def get_sigaa_connection(
    connection: OptionalSigaaConnectionDep,
) -> SigaaConnection:
    if connection is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )
    return connection


SigaaConnectionDep = Annotated[SigaaConnection, Depends(get_sigaa_connection)]


async def get_sigaa_client(connection: SigaaConnectionDep) -> SigaaClient:
    return await connection.client()


SigaaClientDep = Annotated[SigaaClient, Depends(get_sigaa_client)]


async def get_sigaa_public_client() -> AsyncGenerator[SigaaPublicClient]:
    async with SigaaPublicClient() as client:
        yield client


SigaaPublicClientDep = Annotated[SigaaPublicClient, Depends(get_sigaa_public_client)]
