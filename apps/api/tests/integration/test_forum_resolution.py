from concurrent.futures import ThreadPoolExecutor

from sigaa_client import Credentials
from sqlalchemy import select

from api.db.models import ForumPost
from api.modules.forum import service


def create(client, cookies, kind="duvida"):
    client.cookies.update(
        cookies(refresh=Credentials(registration="251000000", password="sintetica123"))
    )
    response = client.post(
        "/forum",
        json={
            "kind": kind,
            "title": "Pergunta para organizar os estudos",
            "body": "Texto sintético.",
        },
    )
    assert response.status_code == 201
    return response.json()


def test_autor_resolve_reabre_e_visitante_filtra_sem_credencial(client, cookies):
    post = create(client, cookies)
    path = f"/forum/{post['id']}/resolved"
    assert post["resolved"] is False
    response = client.patch(path, json={"resolved": True})
    assert response.status_code == 200, response.text
    assert response.json()["resolved"] is True
    client.cookies.clear()
    assert client.get("/forum", params={"order": "resolved"}).json()["total"] == 1
    assert client.get("/forum", params={"order": "unresolved"}).json()["total"] == 0
    assert client.patch(path, json={"resolved": False}).status_code == 401
    client.cookies.update(
        cookies(refresh=Credentials(registration="252000000", password="sintetica123"))
    )
    client.headers["X-Followw-Author"] = "b" * 64
    assert client.patch(path, json={"resolved": False}).status_code == 404
    client.headers["X-Followw-Author"] = "a" * 64
    assert client.patch(path, json={"resolved": False}).json()["resolved"] is False


def test_post_nao_e_duvida_e_nao_aceita_resolucao(client, cookies):
    post = create(client, cookies, "post")
    assert (
        client.patch(
            f"/forum/{post['id']}/resolved", json={"resolved": True}
        ).status_code
        == 422
    )


def test_respostas_concorrentes_respeitam_limite_e_contador_atomico(
    client, cookies, database, monkeypatch
):
    post = create(client, cookies)
    monkeypatch.setattr(service, "MAX_REPLIES", 1)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda number: client.post(
                    f"/forum/{post['id']}/replies",
                    json={"body": f"Resposta sintética {number}"},
                ),
                range(2),
            )
        )
    assert sorted(response.status_code for response in responses) == [201, 409]
    with database() as session:
        assert session.scalar(select(ForumPost.reply_count)) == 1
    reply = next(
        response for response in responses if response.status_code == 201
    ).json()["replies"][0]
    assert (
        client.delete(f"/forum/{post['id']}/replies/{reply['id']}").status_code == 204
    )
    with database() as session:
        assert session.scalar(select(ForumPost.reply_count)) == 0


def test_publicacoes_e_respostas_longas_duplicadas_sao_recusadas_sem_identificar_aluno(
    client, cookies
):
    create(client, cookies)
    body = {
        "kind": "duvida",
        "title": "Pergunta longa sem duplicar a comunidade",
        "body": "Uma explicação suficientemente longa para comparar o conteúdo da publicação.",
    }
    first = client.post("/forum", json=body)
    assert first.status_code == 201
    client.headers["X-Followw-Author"] = "b" * 64
    duplicate = client.post("/forum", json={**body, "body": body["body"].upper()})
    assert duplicate.status_code == 409
    path = f"/forum/{first.json()['id']}/replies"
    reply = {
        "body": "Resposta completa para esclarecer a pergunta sem publicar cópias iguais."
    }
    assert client.post(path, json=reply).status_code == 201
    client.headers["X-Followw-Author"] = "c" * 64
    assert client.post(path, json=reply).status_code == 409
    assert client.post(path, json={"body": "Obrigado"}).status_code == 201
    assert client.post(path, json={"body": "Obrigado"}).status_code == 201
