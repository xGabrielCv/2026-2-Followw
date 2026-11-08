"""O aluno logado, sem nada dele no banco.

O perfil fica num cookie cifrado do navegador; turmas, menções, frequência e participantes vêm do
SIGAA a cada pedido. O navegador guarda as respostas (cache do app) e o servidor só grava o que é
público e não identifica ninguém: a turma, as aulas pelo horário e os índices.
"""

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import Depends, Request, Response
from sigaa_client import Classroom, ClassroomGrade, SigaaClient, UserProfile

from api.cache import CacheControlDep
from api.cookies import read_profile_cookie, set_profile_cookie
from api.sigaa import OptionalSigaaConnectionDep, SigaaConnection, SigaaConnectionDep

# O SIGAA muda o perfil raramente; o app também o renova ao abrir.
PROFILE_TTL = timedelta(hours=24)


class Account:
    """O que o SIGAA diz do aluno nesta requisição, buscado uma vez só."""

    def __init__(
        self,
        connection: SigaaConnection,
        request: Request | None = None,
        response: Response | None = None,
        *,
        fresh: bool = False,
    ) -> None:
        self.connection = connection
        self._request = request
        self._response = response
        # `Cache-Control: no-cache`: nem o perfil do cookie serve.
        self._fresh = fresh
        self._profile: UserProfile | None = None
        self._classrooms: list[Classroom] | None = None
        self._grades: list[ClassroomGrade] | None = None

    @property
    def registration(self) -> str:
        return self.connection.registration

    async def client(self) -> SigaaClient:
        return await self.connection.client()

    async def profile(self, *, refresh: bool = False) -> UserProfile:
        if self._profile is not None and not refresh:
            return self._profile
        saved = (
            read_profile_cookie(self._request, self.registration)
            if self._request is not None and not (refresh or self._fresh)
            else None
        )
        if saved is not None and datetime.now(UTC) - saved[1] < PROFILE_TTL:
            self._profile = saved[0]
            return self._profile
        client = await self.client()
        self._profile = await client.profile.get_profile()
        if self._response is not None:
            set_profile_cookie(
                self._response, self._profile, self.registration, datetime.now(UTC)
            )
        return self._profile

    async def classrooms(self) -> list[Classroom]:
        if self._classrooms is None:
            client = await self.client()
            self._classrooms = list(await client.classrooms.list_classrooms())
        return self._classrooms

    async def grades(self) -> list[ClassroomGrade]:
        if self._grades is None:
            client = await self.client()
            self._grades = list(await client.classrooms.list_grades())
        return self._grades


async def get_optional_account(
    connection: OptionalSigaaConnectionDep,
    request: Request,
    response: Response,
    cache: CacheControlDep,
) -> Account | None:
    if connection is None:
        return None
    return Account(connection, request, response, fresh=cache.no_cache)


OptionalAccountDep = Annotated[Account | None, Depends(get_optional_account)]


async def get_account(
    _authenticated: SigaaConnectionDep, account: OptionalAccountDep
) -> Account:
    # `SigaaConnectionDep` já respondeu 401 aos visitantes.
    assert account is not None
    return account


AccountDep = Annotated[Account, Depends(get_account)]
