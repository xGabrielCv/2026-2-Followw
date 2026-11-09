from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from http.cookies import SimpleCookie
from types import SimpleNamespace
from unittest.mock import ANY, AsyncMock

import httpx
import pytest
from pydantic import SecretStr
from sigaa_client import (
    AuthenticationFailed,
    Credentials,
    DocumentUnavailable,
    MissingProfilePhoto,
    RestaurantCredentials,
    RestaurantStatement,
    RestaurantStatementEntry,
    SessionExpired,
    SigaaParseError,
    UserProfile,
)
from sigaa_client import UserLevel as SigaaUserLevel
from sigaa_client.config import SIGAA_BASE_URL
from sqlalchemy import select

from api.cookies import (
    ACCESS_COOKIE_NAME,
    PROFILE_COOKIE_NAME,
    REFRESH_COOKIE_NAME,
    decrypt_cookie,
    encrypt_cookie,
)
from api.db.main import get_sessionmaker
from api.db.models import Course, Curriculum

CREDENCIAIS = Credentials(registration="251000000", password=SecretStr("senha123"))
NO_CACHE = {"Cache-Control": "no-cache"}
PERFIL = """
<html><body><div id="perfil-docente">
  <div class="foto"><img src="/arquivos/foto.jpg" /></div>
  <div class="info-docente"><span class="nome">NOME DISCENTE</span>Bio de teste.</div>
  <table>
    <tr><td>Matrícula:</td><td>251000000</td></tr>
    <tr><td>Curso:</td><td>ENGENHARIA DE SOFTWARE/FCTE - Bacharelado</td></tr>
    <tr><td>Nível:</td><td>GRADUAÇÃO</td></tr>
    <tr><td>Entrada:</td><td>2025.1</td></tr>
    <tr><td colspan="2"><table>
      <tr><td><acronym>IRA:</acronym></td><td>3.9524</td></tr>
      <tr><td><acronym>MP:</acronym></td><td>4.1724</td></tr>
    </table></td></tr>
    <tr><td colspan="2"><table>
      <tr><td> CH. Obrigat&#243;ria Pendente </td><td> 2175 </td></tr>
      <tr><td> CH. Optativa Pendente </td><td> 420 </td></tr>
      <tr><td> CH. Total Curr&#237;culo </td><td> 3525 </td></tr>
      <tr><td> CH. Complementar Pendente </td><td> 0 </td></tr>
    </table></td></tr>
  </table>
  <span>35% Integralizado</span>
</div></body></html>
"""


def test_login_seguido_de_me_responde_do_cookie_do_navegador(client, sigaa):
    sigaa.profile = PERFIL
    login = client.post(
        "/auth/sigaa", json={"registration": "251000000", "password": "senha123"}
    )
    assert login.status_code == 200
    requests_before = sigaa.profile_requests

    response = client.get("/me")

    assert response.status_code == 200
    assert response.json() == {
        "name": "NOME DISCENTE",
        "registration": "251000000",
        "photo": f"{SIGAA_BASE_URL}/arquivos/foto.jpg",
        "email": None,
        "bio": "Bio de teste.",
        "unit": {"id": 673, "code": "FCTE", "name": "CAMPUS UNB GAMA"},
        "course": {"id": ANY, "name": "ENGENHARIA DE SOFTWARE", "shift": None},
        "entry_semester": "2025.1",
        "integralization": 35,
        "workload": {
            "total": 3525,
            "pending_mandatory": 2175,
            "pending_optional": 420,
            "pending_complementary": 0,
        },
        "period_max_workload": None,
        "ira": 3.9524,
        "mp": 4.1724,
        "level": "Graduação",
    }
    assert sigaa.profile_requests == requests_before
    sigaa.profile = PERFIL.replace("3.9524", "4.0")
    assert client.get("/me").json()["ira"] == 3.9524
    assert client.get("/me", headers=NO_CACHE).json()["ira"] == 4.0
    assert client.get("/me").json()["ira"] == 4.0
    assert sigaa.profile_requests == requests_before + 1
    # Só a sessão do usuário: nenhum job do servidor abre outra.
    assert (sigaa.logins, sigaa.logouts) == (1, 0)


def test_troca_de_curso_loga_com_a_matricula_antiga_e_me_responde_o_perfil(
    client, sigaa, database
):
    # O CAS só aceita a matrícula antiga; o perfil já mostra a do curso novo.
    sigaa.profile = PERFIL.replace("<td>251000000</td>", "<td>252000000</td>")
    login = client.post(
        "/auth/sigaa", json={"registration": "251000000", "password": "senha123"}
    )
    assert login.status_code == 200

    response = client.get("/me")

    assert response.status_code == 200
    assert response.json()["registration"] == "252000000"
    # O cookie fica preso ao login (a matrícula antiga), que é o do refresh_token.
    perfil = decrypt_cookie(PROFILE_COOKIE_NAME, login.cookies[PROFILE_COOKIE_NAME])
    assert (perfil["login"], perfil["profile"]["registration"]) == (
        "251000000",
        "252000000",
    )


def test_me_sem_campos_opcionais_retorna_null(client, sigaa, cookies):
    client.cookies.update(cookies(refresh=CREDENCIAIS))

    response = client.get("/me")

    assert response.status_code == 200
    for field in (
        "photo",
        "email",
        "bio",
        "entry_semester",
        "integralization",
        "workload",
        "period_max_workload",
        "ira",
        "mp",
    ):
        assert response.json()[field] is None


def test_me_traz_carga_maxima_por_periodo_da_matriz(client, sigaa, database):
    sigaa.profile = PERFIL
    client.post(
        "/auth/sigaa", json={"registration": "251000000", "password": "senha123"}
    )
    # o curso entra no catálogo público quando o perfil é lido
    assert client.get("/me").json()["period_max_workload"] is None
    with database.begin() as session:
        course = session.scalars(select(Course)).one()
        session.add(
            Curriculum(
                course_id=course.id,
                sigaa_id=1,
                code="6360/1",
                valid_from="2025.1",
                created_year=2025,
                active=True,
                matrix="ENGENHARIA DE SOFTWARE",
                period_max_workload=420,
            )
        )

    # A matriz é inferida do perfil a cada pedido, pelo catálogo público.
    assert client.get("/me").json()["period_max_workload"] == 420


def test_perfil_vencido_ou_de_outro_login_volta_ao_sigaa(client, sigaa, cookies):
    sigaa.profile = PERFIL
    perfil = UserProfile(
        name="Nome Antigo",
        registration="251000000",
        photo=None,
        bio=None,
        unit="FCTE",
        course="ENGENHARIA DE SOFTWARE",
        shift=None,
        entry_semester=None,
        integralization=None,
        workload=None,
        ira=None,
        mp=None,
        level=SigaaUserLevel.GRADUACAO,
    )
    sigaa.valid_tokens.add("app14~VIVO")
    agora = datetime.now(UTC)
    client.cookies.update(
        cookies(
            access="app14~VIVO", refresh=CREDENCIAIS, profile=perfil, synced_at=agora
        )
    )
    antes = sigaa.profile_requests
    assert client.get("/me").json()["name"] == "Nome Antigo"
    assert sigaa.profile_requests == antes

    client.cookies.update(
        cookies(
            access="app14~VIVO",
            refresh=CREDENCIAIS,
            profile=perfil,
            synced_at=agora - timedelta(hours=25),
        )
    )
    assert client.get("/me").json()["name"] == "NOME DISCENTE"
    assert sigaa.profile_requests == antes + 1

    # cookie de perfil de outra conta não vale para este login
    outra = Credentials(registration="252000000", password=SecretStr("x"))
    client.cookies.set(
        PROFILE_COOKIE_NAME, cookies(refresh=outra, profile=perfil)[PROFILE_COOKIE_NAME]
    )
    assert client.get("/me").json()["name"] == "NOME DISCENTE"


@pytest.mark.parametrize("refresh", [None, "cookie-invalido", "expirado"])
def test_me_sem_refresh_valido_retorna_401(client, sigaa, cookies, refresh):
    sigaa.valid_tokens.add("app14~VIVO")
    client.cookies.update(cookies(access="app14~VIVO"))
    if refresh == "expirado":
        refresh = encrypt_cookie(
            REFRESH_COOKIE_NAME,
            {
                "registration": CREDENCIAIS.registration,
                "password": "senha123",
                "exp": int((datetime.now(UTC) - timedelta(minutes=1)).timestamp()),
            },
        )
    if refresh is not None:
        client.cookies.set(REFRESH_COOKIE_NAME, refresh)

    response = client.get("/me")

    assert response.status_code == 401
    assert sigaa.logins == 0


def test_me_sem_cookies_retorna_401(client, sigaa):
    assert client.get("/me").status_code == 401
    assert sigaa.logins == 0


@pytest.mark.parametrize("access", [None, "app14~MORTO"])
def test_me_renova_sessao_e_devolve_cookies(client, sigaa, cookies, access):
    client.cookies.update(cookies(access=access, refresh=CREDENCIAIS))

    response = client.get("/me")

    assert response.status_code == 200
    assert sigaa.logins == 1
    token = decrypt_cookie(ACCESS_COOKIE_NAME, response.cookies[ACCESS_COOKIE_NAME])
    assert token["session_token"] == "app14~TOKEN1"
    assert REFRESH_COOKIE_NAME in response.cookies


@pytest.mark.parametrize("access", [None, "app14~MORTO"])
def test_me_com_credenciais_recusadas_retorna_401(client, sigaa, cookies, access):
    client.cookies.update(cookies(access=access, refresh=CREDENCIAIS))
    sigaa.password = "senha-alterada"

    assert client.get("/me").status_code == 401


@pytest.mark.parametrize("access", [None, "app14~VIVO"])
def test_me_com_sigaa_indisponivel_retorna_502(client, sigaa, cookies, access):
    sigaa.valid_tokens.add("app14~VIVO")
    client.cookies.update(cookies(access=access, refresh=CREDENCIAIS))
    sigaa.unavailable = True

    response = client.get("/me")

    assert response.status_code == 502
    assert response.json() == {"detail": "SIGAA is unavailable"}


def test_me_com_login_sem_token_retorna_502(client, sigaa, cookies):
    client.cookies.update(cookies(refresh=CREDENCIAIS))
    sigaa.mode = "sem_cookie"

    assert client.get("/me").status_code == 502


@pytest.mark.parametrize(
    "page",
    [
        pytest.param("<html>layout inesperado</html>", id="sem-perfil"),
        pytest.param(PERFIL.replace("3.9524", "invalido"), id="ira-invalido"),
    ],
)
def test_me_com_perfil_invalido_retorna_502(client, sigaa, cookies, page):
    sigaa.valid_tokens.add("app14~VIVO")
    client.cookies.update(cookies(access="app14~VIVO", refresh=CREDENCIAIS))
    sigaa.profile = page

    assert client.get("/me").status_code == 502


def test_me_aceita_indice_zero(client, sigaa, cookies):
    sigaa.valid_tokens.add("app14~VIVO")
    client.cookies.update(cookies(access="app14~VIVO", refresh=CREDENCIAIS))
    sigaa.profile = PERFIL.replace("4.1724", "0")

    response = client.get("/me")

    assert response.status_code == 200
    assert response.json()["mp"] == 0


def test_me_com_erro_http_do_sigaa_retorna_502(client, sigaa, cookies):
    sigaa.valid_tokens.add("app14~VIVO")
    client.cookies.update(cookies(access="app14~VIVO", refresh=CREDENCIAIS))
    sigaa.profile_status = 503

    assert client.get("/me").status_code == 502


def test_me_apos_logout_exige_novo_login(client, sigaa):
    client.post(
        "/auth/sigaa", json={"registration": "251000000", "password": "senha123"}
    )
    assert client.get("/me").status_code == 200
    assert client.delete("/auth/sigaa").status_code == 200
    assert client.get("/me").status_code == 401


def test_me_documenta_campos_e_erros(client):
    schema = client.get("/openapi.json").json()
    route = schema["paths"]["/me"]["get"]
    assert "401" in route["responses"]
    fields = schema["components"]["schemas"]["UserProfile"]["properties"]
    assert {
        "name",
        "photo",
        "email",
        "bio",
        "unit",
        "course",
        "entry_semester",
        "integralization",
        "workload",
        "period_max_workload",
        "ira",
        "mp",
    } <= fields.keys()
    assert "password" not in fields
    assert "session_token" not in fields


def _entry(description, amount="0.00", *, day=25):
    return RestaurantStatementEntry(
        occurred_at=datetime.fromisoformat(f"2026-09-{day}T12:00:00"),
        description=description,
        amount=Decimal(amount),
    )


@pytest.fixture
def documents(stub_sigaa):
    pdf = b"%PDF-1.7\n%teste\n%%EOF"
    stub_sigaa.documents = SimpleNamespace(
        get_student_card_pdf=AsyncMock(return_value=pdf),
        get_transcript_pdf=AsyncMock(return_value=pdf),
    )
    return stub_sigaa.documents


@pytest.fixture
def restaurant(stub_sigaa):
    stub_sigaa.restaurant = SimpleNamespace(
        get_restaurant_statement=AsyncMock(
            return_value=RestaurantStatement(
                balance=Decimal("12.50"),
                group=2,
                entries=(
                    _entry("Saldo", "12.50"),
                    _entry("Grupo 2 Almoço", "6.10"),
                ),
            )
        ),
        get_restaurant_credentials=AsyncMock(
            return_value=RestaurantCredentials(
                token="TOKEN-TESTE",
                valid_until=date(2027, 3, 1),
            )
        ),
    )
    return stub_sigaa.restaurant


DOCUMENT_DOWNLOADS = [
    ("student-card", "get_student_card_pdf"),
    ("transcript", "get_transcript_pdf"),
]


@pytest.mark.parametrize(
    "path,method,filename",
    [
        ("student-card", "get_student_card_pdf", "carteirinha.pdf"),
        ("transcript", "get_transcript_pdf", "historico.pdf"),
    ],
)
def test_download_documento_preserva_conteudo_cookies_e_nao_usa_cache(
    client, cookies, documents, qstash, path, method, filename
):
    def banco_proibido():
        pytest.fail("Download de documento não deve usar banco")

    client.app.dependency_overrides[get_sessionmaker] = banco_proibido
    client.cookies.update(cookies(refresh=CREDENCIAIS))
    for _ in range(2):
        response = client.post(f"/me/{path}")
        assert response.status_code == 200
        assert response.content == getattr(documents, method).return_value
        assert response.headers["content-type"] == "application/pdf"
        assert (
            response.headers["content-disposition"]
            == f'attachment; filename="{filename}"'
        )
        assert response.headers["cache-control"] == "no-store"
        assert int(response.headers["content-length"]) == len(response.content)
        assert ACCESS_COOKIE_NAME in response.cookies
        assert REFRESH_COOKIE_NAME in response.cookies
    assert getattr(documents, method).await_count == 2
    assert qstash.published == []


@pytest.mark.parametrize("path,method", DOCUMENT_DOWNLOADS)
def test_download_documento_exige_login(client, stub_sigaa, documents, path, method):
    assert client.post(f"/me/{path}").status_code == 401
    getattr(documents, method).assert_not_awaited()
    stub_sigaa.created.assert_not_called()


@pytest.mark.parametrize(
    "error,status",
    [
        (AuthenticationFailed(), 401),
        (SessionExpired(), 502),
        (SigaaParseError("PDF inválido"), 502),
        (httpx.ReadTimeout("fora"), 502),
    ],
)
@pytest.mark.parametrize("path,method", DOCUMENT_DOWNLOADS)
def test_download_documento_traduz_erros(
    client, cookies, documents, error, status, path, method
):
    client.cookies.update(cookies(refresh=CREDENCIAIS))
    getattr(documents, method).side_effect = error
    assert client.post(f"/me/{path}").status_code == status


_SEM_FOTO = "Não foi possível emitir a carteirinha pois você não possui foto de perfil."


@pytest.mark.parametrize("path,method", DOCUMENT_DOWNLOADS)
def test_download_recusado_pelo_sigaa_retorna_422_com_motivo(
    client, cookies, documents, path, method
):
    client.cookies.update(cookies(refresh=CREDENCIAIS))
    getattr(documents, method).side_effect = DocumentUnavailable("Motivo do SIGAA")
    response = client.post(f"/me/{path}")
    assert response.status_code == 422
    assert response.json() == {
        "detail": "Não foi possível emitir o documento: Motivo do SIGAA"
    }


def test_carteirinha_sem_foto_explica_o_motivo(client, cookies, documents, restaurant):
    client.cookies.update(cookies(refresh=CREDENCIAIS))
    error = MissingProfilePhoto("Discente não possui foto")
    documents.get_student_card_pdf.side_effect = error
    restaurant.get_restaurant_credentials.side_effect = error
    for response in (client.post("/me/student-card"), client.get("/me/ru-token")):
        assert response.status_code == 422
        assert response.json() == {"detail": _SEM_FOTO}


@pytest.mark.parametrize("path", ["student-card", "transcript"])
def test_openapi_documenta_download_documento(client, path):
    methods = client.get("/openapi.json").json()["paths"][f"/me/{path}"]
    assert "get" not in methods
    route = methods["post"]
    assert route["tags"] == ["Me"]
    assert {"401", "422", "502"} <= route["responses"].keys()
    assert route["responses"]["200"]["content"] == {
        "application/pdf": {"schema": {"type": "string", "format": "binary"}}
    }


@pytest.mark.parametrize("path,method", DOCUMENT_DOWNLOADS)
def test_download_documento_rejeita_get(client, documents, path, method):
    assert client.get(f"/me/{path}").status_code == 405
    getattr(documents, method).assert_not_awaited()


@pytest.mark.parametrize(
    "path,method",
    [
        ("statement", "get_restaurant_statement"),
        ("token", "get_restaurant_credentials"),
    ],
)
def test_dados_privados_sem_banco_fila_ou_cache(
    client, cookies, restaurant, qstash, path, method
):
    def banco_proibido():
        pytest.fail("Dados privados do RU não devem usar banco")

    client.app.dependency_overrides[get_sessionmaker] = banco_proibido
    client.cookies.update(cookies(refresh=CREDENCIAIS))
    response = client.get(f"/me/ru-{path}")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    if path == "statement":
        assert response.json()["balance"] == "12.50"
        assert response.json()["group"] == 2
        assert len(response.json()["entries"]) == 2
        restaurant.get_restaurant_statement.side_effect = SigaaParseError(
            "Saldo ausente"
        )
        missing = client.get(f"/me/ru-{path}")
        assert missing.status_code == 502
        assert missing.headers["cache-control"] == "no-store"
    else:
        assert response.json() == {"token": "TOKEN-TESTE", "valid_until": "2027-03-01"}
        restaurant.get_restaurant_credentials.return_value = RestaurantCredentials(
            token="NOVO", valid_until=date(2027, 4, 1)
        )
        assert client.get(f"/me/ru-{path}").json()["token"] == "NOVO"
    assert getattr(restaurant, method).await_count == 2
    assert qstash.published == []


@pytest.mark.parametrize("group", [1, 2, 3, 4])
def test_extrato_repassa_grupo_saldo_e_movimentos_do_client(
    client, cookies, restaurant, group
):
    client.cookies.update(cookies(refresh=CREDENCIAIS))
    restaurant.get_restaurant_statement.return_value = RestaurantStatement(
        balance=Decimal("-1.50"),
        group=group,
        entries=(
            _entry("Grupo 2 Almoço", "6.10", day=20),
            _entry(f"Grupo {group} Jantar", "6.10", day=24),
            _entry("Saldo", "-1.50", day=25),
            _entry("Saldo", "100.00", day=20),
        ),
    )
    response = client.get("/me/ru-statement")
    assert response.status_code == 200
    assert response.json()["group"] == group
    assert response.json()["balance"] == "-1.50"
    assert len(response.json()["entries"]) == 4


def test_extrato_sem_saldo_ou_grupo_nao_presume_valores(client, cookies, restaurant):
    client.cookies.update(cookies(refresh=CREDENCIAIS))
    restaurant.get_restaurant_statement.side_effect = SigaaParseError("Saldo ausente")
    response = client.get("/me/ru-statement")
    assert response.status_code == 502
    assert "balance" not in response.json()


def test_refresh_do_extrato_abre_sessao_nova_para_obter_saldo_atual(
    client, cookies, sigaa, qstash, monkeypatch
):
    sigaa.valid_tokens.add("app14~VIVO")
    client.cookies.update(cookies(access="app14~VIVO", refresh=CREDENCIAIS))
    opened = set()
    balances = {}
    amount = "49,50"

    def dashboard(request):
        token = SimpleCookie(request.headers["cookie"])["JSESSIONID"].value
        assert token in sigaa.valid_tokens
        balance = balances.setdefault(token, amount)
        if request.method == "POST":
            assert token not in opened
            opened.add(token)
        if token in opened:
            return httpx.Response(
                200,
                text=f"""
                <h4>Extrato no Restaurante Universitário</h4><table>
                <tr><td>25/09/2026 22:15</td><td>Saldo</td><td>{balance}</td></tr>
                <tr><td>25/09/2026 12:00</td><td>Grupo 3 Almoço</td><td>-R$ 4,50</td></tr>
                <tr><td>18/09/2026 22:15</td><td>Saldo Anterior</td><td>49,50</td></tr>
                </table>
            """,
            )
        return httpx.Response(
            200,
            text="""
            <form id="formExibirExtrato" name="formExibirExtrato"
                action="/sigaa/portais/discente/discente.jsf">
              <input type="hidden" name="formExibirExtrato" value="formExibirExtrato">
              <input type="hidden" name="javax.faces.ViewState" value="VS1">
              <a onclick="jsfcljs(document.getElementById('formExibirExtrato'),
                {'formExibirExtrato:botao':'formExibirExtrato:botao'},'');">
                Mostrar Extrato</a>
            </form>
        """,
        )

    original = sigaa._sigaa
    monkeypatch.setattr(
        sigaa,
        "_sigaa",
        lambda request: (
            dashboard(request)
            if request.url.path == "/sigaa/portais/discente/discente.jsf"
            else original(request)
        ),
    )
    assert client.get("/me/ru-statement").json()["balance"] == "49.50"
    amount = "51,00"
    assert client.get("/me/ru-statement").json()["balance"] == "49.50"
    assert sigaa.logins == 0

    response = client.get("/me/ru-statement", headers=NO_CACHE)

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["balance"] == "51.00"
    assert response.json()["group"] == 3
    assert len(response.json()["entries"]) == 3
    assert response.json()["entries"][1]["amount"] == "-4.50"
    assert "set-cookie" not in response.headers
    assert (sigaa.logins, sigaa.logouts) == (1, 1)
    assert sigaa.valid_tokens == {"app14~VIVO"}
    assert client.get("/me/ru-statement").json()["balance"] == "49.50"
    assert qstash.published == []


@pytest.mark.parametrize("access", [None, "app14~VIVO"])
@pytest.mark.parametrize("error", [None, SigaaParseError("layout mudou")])
def test_refresh_do_extrato_fecha_client_e_sessao_mesmo_em_falha(
    client, cookies, restaurant, stub_sigaa, qstash, access, error
):
    def banco_proibido():
        pytest.fail("Refresh do RU não deve usar banco")

    client.app.dependency_overrides[get_sessionmaker] = banco_proibido
    client.cookies.update(cookies(access=access, refresh=CREDENCIAIS))
    restaurant.get_restaurant_statement.side_effect = error

    response = client.get("/me/ru-statement", headers=NO_CACHE)

    assert response.status_code == (502 if error else 200)
    assert "set-cookie" not in response.headers
    stub_sigaa.created.assert_called_once()
    assert stub_sigaa.created.call_args.kwargs["session_token"] is None
    assert stub_sigaa.created.call_args.kwargs["credentials"] == CREDENCIAIS
    stub_sigaa.authenticate.assert_awaited_once()
    stub_sigaa.logout.assert_awaited_once()
    stub_sigaa.aclose.assert_awaited_once()
    restaurant.get_restaurant_statement.assert_awaited_once()
    assert qstash.published == []


def test_refresh_do_extrato_com_login_recusado_fecha_client_e_limpa_cookies(
    client, cookies, restaurant, stub_sigaa, ler_cookies
):
    client.cookies.update(cookies(access="app14~VIVO", refresh=CREDENCIAIS))
    stub_sigaa.authenticate.side_effect = AuthenticationFailed()

    response = client.get("/me/ru-statement", headers=NO_CACHE)

    assert response.status_code == 401
    expired = ler_cookies(response)
    for name in (ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME):
        assert expired[name].value == ""
        assert expired[name]["max-age"] == "0"
    stub_sigaa.aclose.assert_awaited_once()
    stub_sigaa.logout.assert_not_awaited()
    restaurant.get_restaurant_statement.assert_not_awaited()


@pytest.mark.parametrize("path", ["statement", "token"])
def test_dados_privados_exigem_login(client, stub_sigaa, restaurant, path):
    assert client.get(f"/me/ru-{path}").status_code == 401
    stub_sigaa.created.assert_not_called()


@pytest.mark.parametrize(
    "path,method",
    [
        ("statement", "get_restaurant_statement"),
        ("token", "get_restaurant_credentials"),
    ],
)
@pytest.mark.parametrize(
    "error,status",
    [
        (AuthenticationFailed(), 401),
        (SessionExpired(), 502),
        (SigaaParseError("layout mudou"), 502),
        (httpx.ReadTimeout("fora"), 502),
    ],
)
def test_erros_do_sigaa_sao_traduzidos(
    client, cookies, restaurant, path, method, error, status
):
    client.cookies.update(cookies(refresh=CREDENCIAIS))
    getattr(restaurant, method).side_effect = error
    assert client.get(f"/me/ru-{path}").status_code == status


def test_openapi_documenta_dados_privados_do_restaurante(client):
    schema = client.get("/openapi.json").json()
    paths = schema["paths"]
    for path in ("statement", "token"):
        assert paths[f"/me/ru-{path}"]["get"]["tags"] == ["Me"]
        assert {"401", "502"} <= paths[f"/me/ru-{path}"]["get"]["responses"].keys()
    assert "422" in paths["/me/ru-token"]["get"]["responses"]
    assert {"balance", "group", "entries"} <= schema["components"]["schemas"][
        "RestaurantStatement"
    ]["properties"].keys()
    assert schema["components"]["schemas"]["RestaurantStatement"]["properties"][
        "group"
    ]["anyOf"][0]["enum"] == [1, 2, 3, 4]
