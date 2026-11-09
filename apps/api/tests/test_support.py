import importlib.util
import pathlib
from uuid import uuid4

import pytest
from sqlalchemy import text

# Os testes ficam fora de um pacote: reaproveita as fixtures de cargos do arquivo irmão.
_spec = importlib.util.spec_from_file_location(
    "admin_security_fixtures",
    pathlib.Path(__file__).with_name("test_admin_security.py"),
)
_fixtures = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_fixtures)
HEADERS, owner, roles = _fixtures.HEADERS, _fixtures.owner, _fixtures.roles

OUTRO_APARELHO = "b" * 64
NOVO = {
    "category": "bug",
    "title": "O app trava ao abrir a agenda",
    "body": "Ao abrir a agenda do dia a tela fica branca por alguns segundos.",
}


def abrir(client, **extra):
    response = client.post("/support/tickets", json={**NOVO, **extra})
    assert response.status_code == 201, response.text
    data = response.json()
    return data, {"X-Ticket-Key": data["key"]}


def como(client, cookies):
    client.cookies.clear()
    client.cookies.update(cookies)


def test_abre_consulta_responde_e_encerra_sem_nenhum_login(client):
    ticket, key = abrir(client)
    assert ticket["number"] >= 1
    assert len(ticket["key"]) >= 32 and len(ticket["recovery_code"]) == 19

    view = client.get(f"/support/tickets/{ticket['id']}", headers=key).json()
    assert view["status"] == "open"
    assert [m["sender"] for m in view["messages"]] == ["student"]

    replied = client.post(
        f"/support/tickets/{ticket['id']}/messages",
        json={"body": "Acontece só no celular."},
        headers=key,
    ).json()
    assert replied["message_count"] == 2

    closed = client.post(f"/support/tickets/{ticket['id']}/close", headers=key).json()
    assert closed["status"] == "closed" and closed["can_reopen"] is True
    assert (
        client.post(
            f"/support/tickets/{ticket['id']}/messages",
            json={"body": "Mais uma coisa."},
            headers=key,
        ).status_code
        == 409
    )
    reopened = client.post(
        f"/support/tickets/{ticket['id']}/reopen", headers=key
    ).json()
    assert reopened["status"] == "open"


def test_terceiros_nao_acessam_nem_enumeram_chamados(client):
    ticket, key = abrir(client)
    wrong = {"X-Ticket-Key": "x" * 43}
    for headers in (wrong, {"X-Ticket-Key": uuid4().hex + uuid4().hex}):
        response = client.get(f"/support/tickets/{ticket['id']}", headers=headers)
        assert response.status_code == 404
    inexistente = client.get(f"/support/tickets/{uuid4()}", headers=key)
    certo_com_chave_errada = client.get(
        f"/support/tickets/{ticket['id']}", headers=wrong
    )
    assert inexistente.json() == certo_com_chave_errada.json()
    assert client.get(f"/support/tickets/{ticket['id']}").status_code == 422


def test_servidor_guarda_so_verificadores_e_texto_cifrado(client, database):
    ticket, _ = abrir(client)
    with database() as session:
        row = session.execute(
            text("SELECT secret_hash, recovery_hash, title, author_key FROM tickets")
        ).one()
        message = session.execute(text("SELECT body FROM ticket_messages")).scalar_one()
    blob = " ".join(map(str, row)) + message
    assert ticket["key"] not in blob and ticket["recovery_code"] not in blob
    assert row.title.startswith("v2:") and message.startswith("v2:")
    assert NOVO["title"] not in blob and NOVO["body"] not in blob
    assert "a" * 64 not in blob  # o segredo do aparelho nunca é guardado


def test_recuperacao_troca_a_chave_e_a_antiga_deixa_de_valer(client):
    ticket, old = abrir(client)
    client.headers.pop("X-Followw-Author")  # outro navegador: sem nada do aparelho
    errado = client.post(
        "/support/recover", json={"id": ticket["id"], "code": "0000-0000-0000-0000"}
    )
    assert errado.status_code == 404
    recovered = client.post(
        "/support/recover",
        json={
            "id": ticket["id"],
            "code": ticket["recovery_code"].lower().replace("-", " "),
        },
    )
    assert recovered.status_code == 200
    new = {"X-Ticket-Key": recovered.json()["key"]}
    assert (
        client.get(f"/support/tickets/{ticket['id']}", headers=new).status_code == 200
    )
    assert (
        client.get(f"/support/tickets/{ticket['id']}", headers=old).status_code == 404
    )


def test_recuperacao_tem_limite_de_tentativas_por_chamado(client):
    ticket, _ = abrir(client)
    codes = [
        client.post(
            "/support/recover", json={"id": ticket["id"], "code": "AAAA-BBBB-CCCC-DDDD"}
        ).status_code
        for _ in range(8)
    ]
    assert codes[:5] == [404] * 5 and 429 in codes[5:]


@pytest.mark.parametrize(
    "texto",
    [
        "Meu CPF é 123.456.789-09 e preciso de ajuda",
        "Me responda em aluno@exemplo.com por favor",
        "Minha matrícula é 190012345 e deu erro",
    ],
)
def test_dados_pessoais_no_texto_sao_recusados(client, texto):
    response = client.post("/support/tickets", json={**NOVO, "body": texto})
    assert response.status_code == 422
    assert "dados pessoais" in response.json()["detail"]


def test_abrir_chamado_tem_cota_por_origem_de_rede_e_por_hora(client):
    for _ in range(10):
        abrir(client)
    assert client.post("/support/tickets", json=NOVO).status_code == 429


def test_abrir_nao_exige_nem_guarda_identificador_de_aparelho(client, database):
    client.headers.pop("X-Followw-Author")
    ticket, _ = abrir(client)
    with database() as session:
        assert (
            session.execute(text("SELECT author_key FROM tickets")).scalar_one() is None
        )
    assert ticket["number"] >= 1


def test_categoria_invalida_e_texto_curto_sao_recusados(client):
    assert (
        client.post("/support/tickets", json={**NOVO, "category": "x"}).status_code
        == 422
    )
    assert (
        client.post("/support/tickets", json={**NOVO, "title": "oi"}).status_code == 422
    )


def test_fluxo_completo_aluno_e_atendimento(client, roles):
    http, cookies, users = roles
    http.cookies.clear()
    ticket, key = abrir(http, related_type="review", related_id=str(uuid4()))
    tid = ticket["id"]

    como(http, cookies["moderator"])
    fila = http.get("/admin/api/tickets", headers=HEADERS).json()
    assert fila["total"] == 1 and fila["items"][0]["number"] == ticket["number"]
    assert http.get("/admin/api/tickets/summary", headers=HEADERS).json()["open"] == 1
    assert (
        http.patch(
            f"/admin/api/tickets/{tid}",
            json={
                "assign": True,
                "assigned_to": users["moderator"]["id"],
                "priority": "high",
            },
            headers=HEADERS,
        ).status_code
        == 204
    )
    assert (
        http.post(
            f"/admin/api/tickets/{tid}/note",
            json={"body": "Parece o mesmo bug do iOS."},
            headers=HEADERS,
        ).status_code
        == 204
    )
    assert (
        http.post(
            f"/admin/api/tickets/{tid}/reply",
            json={
                "body": "Obrigado! Qual celular você usa?",
                "status": "waiting_student",
            },
            headers=HEADERS,
        ).status_code
        == 204
    )
    interno = http.get(f"/admin/api/tickets/{tid}", headers=HEADERS).json()
    assert [m["sender"] for m in interno["messages"]] == ["student", "note", "staff"]
    assert (
        interno["assigned_name"] == "moderator-teste" and interno["priority"] == "high"
    )

    http.cookies.clear()
    visto = http.get(f"/support/tickets/{tid}", headers=key).json()
    assert visto["status"] == "waiting_student"
    assert [m["sender"] for m in visto["messages"]] == ["student", "staff"]
    assert "Parece o mesmo bug" not in str(visto)  # nota interna nunca chega ao aluno
    assert "moderator-teste" not in str(visto)

    http.post(
        f"/support/tickets/{tid}/messages",
        json={"body": "Um Android antigo."},
        headers=key,
    )
    assert http.get(f"/support/tickets/{tid}", headers=key).json()["status"] == "open"

    como(http, cookies["administrator"])
    assert (
        http.post(
            f"/admin/api/tickets/{tid}/reply",
            json={"body": "Corrigido na versão nova.", "status": "closed"},
            headers=HEADERS,
        ).status_code
        == 204
    )
    http.cookies.clear()
    final = http.get(f"/support/tickets/{tid}", headers=key).json()
    assert (
        final["status"] == "closed" and final["can_reopen"] is False
    )  # encerrado pelo atendimento
    assert http.post(f"/support/tickets/{tid}/reopen", headers=key).status_code == 409

    como(http, cookies["owner"])
    log = http.get("/admin/api/log", headers=HEADERS).json()
    assert {"support.reply", "support.note", "support.update"} <= {
        e["action"] for e in log
    }


def test_moderador_nao_atribui_a_outro_e_so_o_cargo_com_contas_atribui(client, roles):
    http, cookies, users = roles
    http.cookies.clear()
    ticket, _ = abrir(http)
    body = {"assign": True, "assigned_to": users["administrator"]["id"]}
    como(http, cookies["moderator"])
    assert (
        http.patch(
            f"/admin/api/tickets/{ticket['id']}", json=body, headers=HEADERS
        ).status_code
        == 403
    )
    como(http, cookies["administrator"])
    assert (
        http.patch(
            f"/admin/api/tickets/{ticket['id']}", json=body, headers=HEADERS
        ).status_code
        == 204
    )


def test_filtros_e_busca_da_fila(client, roles):
    http, cookies, _ = roles
    http.cookies.clear()
    abrir(http, category="bug", title="Agenda quebrada no celular")
    abrir(http, category="praise", title="Adorei o simulador de grades")
    como(http, cookies["moderator"])
    get = lambda query: http.get("/admin/api/tickets" + query, headers=HEADERS).json()
    assert get("")["total"] == 2
    assert get("?category=praise")["total"] == 1
    assert get("?q=simulador")["items"][0]["category"] == "praise"
    assert get("?assignee=none")["total"] == 2
    assert get("?status=closed")["total"] == 0
    assert (
        http.get("/admin/api/tickets?category=nada", headers=HEADERS).status_code == 422
    )


def test_rotas_de_atendimento_exigem_sessao(client):
    for method, path in [("GET", ""), ("GET", "/summary"), ("GET", f"/{uuid4()}")]:
        response = client.request(method, "/admin/api/tickets" + path, headers=HEADERS)
        assert response.status_code == 401
