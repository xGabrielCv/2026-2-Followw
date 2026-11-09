import logging
import os
from http.cookies import SimpleCookie

import httpx
import pytest
import respx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sigaa_client import Credentials
from sigaa_client.config import CLASSROOMS_PATH


@pytest.fixture
def caplog(caplog):
    logger = logging.getLogger("followw")
    logger.addHandler(caplog.handler)
    try:
        yield caplog
    finally:
        logger.removeHandler(caplog.handler)


AUTOR_DE_TESTE = "a" * 64
QSTASH_SIGNING_KEY = "sig_atual_de_teste_com_32_bytes_ou_mais"


@pytest.fixture(autouse=True)
def isola_cotas_locais():
    from api.rate_limit import _MEMORY

    _MEMORY.clear()
    yield
    _MEMORY.clear()


# O `Settings` é instanciado no import de `api.core.config`, então as variáveis
# precisam existir antes de qualquer teste importar a app.
os.environ["ENVIRONMENT"] = "testing"
os.environ["CORS_ORIGINS"] = '["https://followw.app"]'
os.environ["DATABASE_URL"] = (
    "postgresql+asyncpg://postgres:postgres@localhost:5432/followw_test"
)
os.environ["JWT_SECRET_KEY"] = "chave-de-teste-nao-usar-em-producao"
os.environ["PUBLIC_URL"] = "https://api.followw.test"
os.environ["APP_DB_ROLE"] = "followw_test_app"

os.environ["QSTASH_URL"] = "https://qstash.upstash.io"
os.environ["QSTASH_TOKEN"] = "token-de-teste"
os.environ["QSTASH_CURRENT_SIGNING_KEY"] = QSTASH_SIGNING_KEY
os.environ["QSTASH_NEXT_SIGNING_KEY"] = "sig_proxima_de_teste_com_32_bytes_ou_mais"
os.environ["UPSTASH_REDIS_REST_URL"] = ""
os.environ["UPSTASH_REDIS_REST_TOKEN"] = ""

PERFIL = """
<html><body><div id="perfil-docente">
  <div class="info-docente"><p class="nome">NOME DISCENTE</p></div>
  <table>
    <tr><td>Matrícula:</td><td>251000000</td></tr>
    <tr><td>Curso:</td><td>ENGENHARIA DE SOFTWARE/FCTE - Bacharelado</td></tr>
    <tr><td>Nível:</td><td>GRADUAÇÃO</td></tr>
  </table>
</div></body></html>
"""

FORM_CAS = """
<html><body><form action="/sso-server/login;jsessionid=ABC?service=x" method="post">
  <input type="text" name="username" />
  <input type="password" name="password" />
  <input type="hidden" name="lt" value="LT-1" />
</form></body></html>
"""

# Recorte da resposta real do CAS a credenciais inválidas.
FORM_CAS_RECUSADO = FORM_CAS.replace(
    'method="post">',
    'method="post"><p id="errors" class="login-error">Credenciais inválidas.</p>',
)


class FakeSigaa:
    """SIGAA de mentira no nível HTTP: valida a senha e exige o JSESSIONID.

    A app monta o `SigaaClient` por conta própria, sem gancho para injetar um
    transport, então o dublê vive onde a app não manda: no socket.
    """

    def __init__(self, password: str = "senha123") -> None:
        self.password = password
        self.valid_tokens: set[str] = set()
        self.logins = 0
        self.logouts = 0
        # Dois jeitos de a outra ponta se comportar mal: sumir da rede
        # (`unavailable`) ou aceitar o login sem devolver o JSESSIONID
        # (`mode = "sem_cookie"`), que é como uma mudança de layout aparece.
        self.unavailable = False
        self.mode = "normal"
        self.profile = PERFIL
        self.grades = "<h3>Relatório de Notas do(a) Aluno(a)</h3>"
        self.profile_status = 200
        self.profile_requests = 0
        self.classrooms = '<html><body><table class="listagem"></table></body></html>'
        self.classrooms_status = 200
        self.classrooms_requests = 0

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if self.unavailable:
            raise httpx.ConnectError("SIGAA fora do ar", request=request)

        if request.url.host == "autenticacao.unb.br":
            return self._cas(request)
        return self._sigaa(request)

    def _cas(self, request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, text=FORM_CAS)

        payload = dict(httpx.QueryParams(request.content.decode()))
        if payload.get("password") != self.password:
            return httpx.Response(200, text=FORM_CAS_RECUSADO)

        return httpx.Response(
            302,
            headers={"location": "https://sigaa.unb.br/sigaa/login/cas?ticket=ST-1"},
        )

    def _sigaa(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path

        if path == "/sigaa/login/cas":
            self.logins += 1
            token = f"app14~TOKEN{self.logins}"
            headers = {"location": "/sigaa/portais/discente/discente.jsf"}
            if self.mode != "sem_cookie":
                self.valid_tokens.add(token)
                headers["set-cookie"] = f"JSESSIONID={token}; Path=/"
            return httpx.Response(302, headers=headers)

        if path == "/sigaa/verTelaLogin.do":
            return httpx.Response(200, text=FORM_CAS)

        if path == "/sigaa/logar.do":
            self.logouts += 1
            self.valid_tokens.discard(_cookie(request, "JSESSIONID"))
            return httpx.Response(200, text="<html>saiu</html>")

        if _cookie(request, "JSESSIONID") not in self.valid_tokens:
            return httpx.Response(
                302, headers={"location": "https://sigaa.unb.br/sigaa/verTelaLogin.do"}
            )
        if path == CLASSROOMS_PATH:
            self.classrooms_requests += 1
            return httpx.Response(self.classrooms_status, text=self.classrooms)

        if path == "/sigaa/portais/discente/discente.jsf" and request.method == "POST":
            return httpx.Response(200, text=self.grades)
        self.profile_requests += 1

        page = self.profile.replace(
            "</body>",
            """
<form id="menu:form_menu_discente" action="/sigaa/portais/discente/discente.jsf">
<input type="hidden" name="javax.faces.ViewState" value="j_id1"/>
</form></body>""",
        )
        return httpx.Response(self.profile_status, text=page)


def _cookie(request: httpx.Request, name: str) -> str | None:
    for part in request.headers.get("cookie", "").split(";"):
        key, _, value = part.strip().partition("=")
        if key == name:
            return value

    return None


@pytest.fixture
def sigaa():
    """Intercepta só o SIGAA e o CAS — o transport ASGI do TestClient passa reto."""
    fake = FakeSigaa()
    with respx.mock:
        respx.route(host__in=["sigaa.unb.br", "autenticacao.unb.br"]).mock(
            side_effect=fake
        )
        yield fake


class FakeQStash:
    """Sonda de privacidade: nenhuma credencial pode sair para uma fila."""

    def __init__(self):
        self.published = []
        self.unavailable = False

    def __call__(self, request):
        self.published.append(request)
        raise AssertionError("Fila persistente não pode receber dados acadêmicos")


@pytest.fixture
def qstash():
    fake = FakeQStash()
    with respx.MockRouter(assert_all_called=False) as router:
        router.route(host="qstash.upstash.io").mock(side_effect=fake)
        yield fake


@pytest.fixture(autouse=True)
def hoje(monkeypatch):
    """Fixa o dia do calendário acadêmico: 2026.2 entre a matrícula extraordinária e
    o fim do trancamento geral. Chame com outra data (ou data e hora) para mudar o dia."""
    from datetime import date, datetime
    from zoneinfo import ZoneInfo

    def _set(day: date | datetime) -> None:
        if not isinstance(day, datetime):
            day = datetime.combine(day, datetime.min.time())
        at = day.replace(tzinfo=ZoneInfo("America/Sao_Paulo"))
        monkeypatch.setattr("api.academic_calendar.now", lambda: at)

    _set(date(2026, 9, 22))
    return _set


@pytest.fixture(scope="session")
def postgres(worker_id, testrun_uid):
    """Banco Postgres em container para a sessão de testes."""
    from sqlalchemy import create_engine
    from testcontainers.community.postgres import PostgresContainer

    from api.db.main import create_schema

    def prepare(url: str):
        from sqlalchemy import text
        from sqlalchemy.engine import make_url

        from api.testing_database import require_test_database

        parsed = make_url(url)
        require_test_database(parsed.database)
        if worker_id != "master":
            name = f"{parsed.database}_{testrun_uid[:12]}_{worker_id}"
            require_test_database(name)
            control = create_engine(
                parsed.set(database="postgres"), isolation_level="AUTOCOMMIT"
            )
            try:
                with control.connect() as connection:
                    connection.execute(text(f'CREATE DATABASE "{name}"'))
            finally:
                control.dispose()
            url = parsed.set(database=name)
        engine = create_engine(url)
        with engine.begin() as conn:
            create_schema(conn)
        return engine

    # Sem Docker: aponta para um Postgres já rodando (o run.ps1 sobe um local).
    if url := os.environ.get("TEST_POSTGRES_URL"):
        engine = prepare(url)
        yield engine
        engine.dispose()
        return

    with PostgresContainer(
        "postgres:18-alpine", driver="psycopg", dbname="followw_test"
    ) as container:
        engine = prepare(container.get_connection_url())
        yield engine
        engine.dispose()


@pytest.fixture
def database(postgres):
    """Sessão síncrona limpa a cada teste; a app usa a versão async."""
    from sqlalchemy import text
    from sqlalchemy.orm import sessionmaker

    from api.db.base import Base
    from api.db.models import Unit

    tables = ", ".join(table.name for table in Base.metadata.sorted_tables)
    sessions = sessionmaker(postgres, expire_on_commit=False)
    with sessions.begin() as session:
        session.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
        session.execute(text("TRUNCATE rate_windows"))
        session.add(Unit(id=673, code="FCTE", name="CAMPUS UNB GAMA"))
    return sessions


@pytest.fixture
def async_database(database):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.pool import NullPool

    url = database.kw["bind"].url.set(drivername="postgresql+asyncpg")
    # Sem pool: o teste pode usar a sessão em mais de um event loop.
    # A API roda com o papel restrito (sem bypass de RLS), como em produção.
    engine = create_async_engine(
        url,
        poolclass=NullPool,
        connect_args={"server_settings": {"role": "followw_test_app"}},
    )
    yield async_sessionmaker(engine, expire_on_commit=False)
    engine.sync_engine.dispose()


@pytest.fixture
def maintenance_database(database):
    """Conta de manutenção (db-init, CLI do administrador, recifragem): sem o papel restrito."""
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.pool import NullPool

    url = database.kw["bind"].url.set(drivername="postgresql+asyncpg")
    engine = create_async_engine(url, poolclass=NullPool)
    yield async_sessionmaker(engine, expire_on_commit=False)
    engine.sync_engine.dispose()


class CommunityTestClient(TestClient):
    """Simula o transporte do app: comprovação com cookies, publicação sem eles."""

    def request(self, method, url, **kwargs):
        from fastapi import HTTPException

        from api.cookies import REFRESH_COOKIE_NAME
        from api.modules.community.permissions import permission_action

        path = str(url).split("?", 1)[0].removeprefix("/api").rstrip("/")
        headers = dict(kwargs.get("headers") or {})
        if (
            any(cookie.name == REFRESH_COOKIE_NAME for cookie in self.cookies.jar)
            and "X-Followw-Permit" not in headers
            and headers.get("X-Test-Raw-Community") != "1"
        ):
            try:
                permission_action(method.upper(), path)
            except HTTPException:
                pass
            else:
                payload = {"method": method.upper(), "path": path}
                if method.upper() == "POST" and path.startswith("/materials/"):
                    import secrets

                    budgets = getattr(self, "_upload_budgets", {})
                    if path not in budgets:
                        budgets[path] = secrets.token_hex(32)
                    self._upload_budgets = budgets
                    payload["upload_key"] = budgets[path]
                permission = super().request(
                    "POST", "/auth/community-permits", json=payload
                )
                if permission.status_code == 200:
                    headers["X-Followw-Permit"] = permission.json()["token"]
                    headers["cookie"] = ""
                    kwargs["headers"] = headers
        return super().request(method, url, **kwargs)


@pytest.fixture
def client(async_database, qstash):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.db.main import get_sessionmaker
    from api.main import app

    # A app reaproveita conexões como em produção, no event loop fixo do client.
    engine = create_async_engine(
        async_database.kw["bind"].url,
        connect_args={"server_settings": {"role": "followw_test_app"}},
    )
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    app.dependency_overrides[get_sessionmaker] = lambda: sessions
    with CommunityTestClient(app) as client:
        # o segredo do aparelho que o app manda: a autoria anônima vem dele, não da matrícula
        client.headers["X-Followw-Author"] = AUTOR_DE_TESTE
        yield client
        client.portal.call(engine.dispose)
    app.dependency_overrides.clear()


@pytest.fixture
def cookies():
    """Monta os cookies de sessão como a própria app os emitiria."""
    # Importado aqui dentro: `api.core.config` lê o ambiente já no import.
    from datetime import UTC, datetime

    from fastapi import Response

    from api.cookies import set_access_cookie, set_profile_cookie, set_refresh_cookie

    def _build(
        *,
        access: str | None = None,
        refresh: Credentials | None = None,
        profile=None,
        synced_at: datetime | None = None,
    ) -> dict[str, str]:
        response = Response()
        login = refresh.registration if refresh else "251000000"
        if access is not None:
            set_access_cookie(response, access, login)
        if refresh is not None:
            set_refresh_cookie(response, refresh)
        if profile is not None:
            set_profile_cookie(response, profile, login, synced_at or datetime.now(UTC))
        return {nome: morsel.value for nome, morsel in _carregar(response).items()}

    return _build


def _carregar(response) -> SimpleCookie:
    headers = response.headers
    # `Response` do Starlette expõe `getlist`; o do httpx, `get_list`.
    brutos = (
        headers.get_list("set-cookie")
        if hasattr(headers, "get_list")
        else headers.getlist("set-cookie")
    )

    jar = SimpleCookie()
    for header in brutos:
        jar.load(header)
    return jar


@pytest.fixture
def ler_cookies():
    """Lê os `Set-Cookie` de uma resposta como um jar, com atributos e tudo."""
    return _carregar


@pytest.fixture
def probe_app():
    """Monta uma app isolada por teste para exercitar dependências sem rota.

    Um `include_router` na app global vazaria a rota de sonda para os outros
    testes e deixaria o resultado na mão da ordem de coleta.
    """

    from api.errors import EXCEPTION_HANDLERS

    def _build(handler) -> TestClient:
        app = FastAPI(exception_handlers=EXCEPTION_HANDLERS)
        app.get("/probe")(handler)
        return TestClient(app)

    return _build


@pytest.fixture
def stub_sigaa(monkeypatch):
    """Troca o `SigaaClient` por dublês de método, para testar o cache sem HTML.

    Só o client muda: conexão, cookies e tradução de erros continuam os da app.
    `created` conta quantos clients a app abriu; cada job abre o seu.
    """
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, Mock

    from sigaa_client import UserLevel, UserProfile

    client = SimpleNamespace(
        authenticate=AsyncMock(return_value="app14~STUB"),
        logout=AsyncMock(),
        aclose=AsyncMock(),
        profile=SimpleNamespace(
            get_profile=AsyncMock(
                return_value=UserProfile(
                    name="NOME DISCENTE",
                    registration="251000000",
                    photo=None,
                    bio=None,
                    unit="FCTE",
                    course="ENGENHARIA DE SOFTWARE",
                    shift=None,
                    entry_semester=None,
                    integralization=35,
                    workload=None,
                    ira=3.5,
                    mp=4.0,
                    level=UserLevel.GRADUACAO,
                )
            )
        ),
        classrooms=SimpleNamespace(
            list_classrooms=AsyncMock(return_value=[]),
            list_classroom_members=AsyncMock(return_value=[]),
            get_classroom_statistics=AsyncMock(return_value=()),
            list_grades=AsyncMock(return_value=[]),
            get_classroom_frequency=AsyncMock(),
            list_classroom_posts=AsyncMock(return_value=[]),
            get_classroom_news=AsyncMock(),
        ),
        internships=SimpleNamespace(
            list_internships=AsyncMock(return_value=[]),
            get_internship=AsyncMock(),
        ),
    )

    client.created = Mock(return_value=client)

    def reset() -> None:
        """Zera as chamadas registradas, mantendo os retornos configurados."""
        for mock in (
            client.created,
            client.authenticate,
            client.logout,
            client.aclose,
            *vars(client.profile).values(),
            *vars(client.classrooms).values(),
            *vars(client.internships).values(),
        ):
            mock.reset_mock()

    client.reset = reset
    monkeypatch.setattr("api.sigaa.SigaaClient", client.created)
    return client


@pytest.fixture(autouse=True)
def estado_de_resiliencia_limpo():
    """Cache e circuitos são por processo: cada teste começa do zero."""
    from api import rate_limit, resilience

    resilience.reset_all()
    rate_limit.reset_memory()
    yield
    resilience.reset_all()
    rate_limit.reset_memory()
