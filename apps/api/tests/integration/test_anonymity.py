"""Anonimato da comunidade: uma credencial aleatória por publicação, sem vínculo entre elas."""

import logging
import secrets
import uuid
from io import BytesIO

import pytest
from PIL import Image
from pydantic import SecretStr
from sigaa_client import Credentials
from sqlalchemy import text

from api.anonymous import anonymous_key, resource_key
from api.db.models import ForumPost, ForumReply, Material, Subject, Tutorial

ANA = Credentials(registration="251000000", password=SecretStr("senha123"))
BIA = Credentials(registration="252000000", password=SecretStr("senha456"))


def nova() -> str:
    return secrets.token_hex(32)


@pytest.fixture
def aluno(client, cookies, database):
    with database.begin() as session:
        session.add(Subject(code="FGA0030", name="ESTRUTURAS DE DADOS 2"))
    client.cookies.update(cookies(refresh=ANA))
    client.headers.pop(
        "X-Followw-Author", None
    )  # nada global: cada pedido leva a chave da publicação
    return client


def postar(client, chave, titulo="Alguém sabe da P1?"):
    resposta = client.post(
        "/forum",
        json={"kind": "duvida", "title": titulo, "body": "Cai recursão?"},
        headers={"X-Followw-Author": chave},
    )
    assert resposta.status_code == 201, resposta.text
    assert resposta.headers["X-Created-Id"] == resposta.json()["id"]
    return resposta.json()["id"]


def responder(client, post, chave, op=None):
    headers = {"X-Followw-Author": chave}
    if op:
        headers["X-Followw-Op-Key"] = op
    resposta = client.post(
        f"/forum/{post}/replies", json={"body": "Cai sim."}, headers=headers
    )
    assert resposta.status_code == 201, resposta.text
    return resposta.headers["X-Created-Id"]


def png(cor):
    buffer = BytesIO()
    Image.new("RGB", (40, 30), cor).save(buffer, "PNG")
    return buffer.getvalue()


def enviar(client, chave, cor):
    return client.post(
        "/materials/FGA0030",
        headers={"X-Followw-Author": chave},
        data={"title": "Lista 1", "kind": "lista", "semester": "2026.1"},
        files={"file": ("lista.png", png(cor), "image/png")},
    )


def test_cada_publicacao_guarda_um_verificador_sem_relacao_com_as_outras(
    aluno, database
):
    chaves = [nova() for _ in range(4)]
    posts = [
        postar(aluno, chave, f"Dúvida {i} bem formulada")
        for i, chave in enumerate(chaves)
    ]
    for post, chave in zip(posts, chaves, strict=True):
        responder(aluno, post, nova())
    with database() as session:
        post_keys = [
            r for (r,) in session.execute(text("SELECT author_key FROM forum_posts"))
        ]
        reply_keys = [
            r for (r,) in session.execute(text("SELECT author_key FROM forum_replies"))
        ]
    todos = post_keys + reply_keys
    # nenhum valor se repete: não existe "a chave do aluno" no banco
    assert len(todos) == 8 and len(set(todos)) == 8
    assert set(post_keys) == {resource_key(c) for c in chaves}
    # a chave de uma publicação não abre outra
    assert (
        aluno.delete(
            f"/forum/{posts[1]}", headers={"X-Followw-Author": chaves[0]}
        ).status_code
        == 404
    )


def test_sem_matricula_nem_identificador_de_aparelho_no_esquema(database):
    with database() as session:
        colunas = session.execute(
            text(
                "SELECT table_name, column_name FROM information_schema.columns "
                "WHERE table_schema = 'public'"
            )
        ).all()
    suspeitas = (
        "registration",
        "matricula",
        "device",
        "fingerprint",
        "user_agent",
        "ip_address",
        "client_ip",
        "email",
        "cpf",
    )
    achadas = [(t, c) for t, c in colunas if any(s in c.lower() for s in suspeitas)]
    # `professors.email` é dado público de docente; o resto não pode existir
    assert [(t, c) for t, c in achadas if (t, c) != ("professors", "email")] == []


def test_edicao_e_exclusao_so_com_a_chave_da_publicacao(aluno):
    chave = nova()
    post = postar(aluno, chave)
    resposta = responder(aluno, post, nova())
    # outro navegador (sem a chave) ou uma chave qualquer: nada acontece
    for headers in ({}, {"X-Followw-Author": nova()}):
        assert aluno.delete(f"/forum/{post}", headers=headers).status_code in {400, 404}
    # só a chave certa apaga, e só a própria resposta se apaga com a chave da resposta
    assert (
        aluno.delete(
            f"/forum/{post}/replies/{resposta}", headers={"X-Followw-Author": chave}
        ).status_code
        == 404
    )
    assert (
        aluno.delete(f"/forum/{post}", headers={"X-Followw-Author": chave}).status_code
        == 204
    )
    assert aluno.get(f"/forum/{post}").status_code == 404


def test_quem_abriu_a_conversa_e_reconhecido_so_provando_a_chave_do_post(aluno):
    chave_post = nova()
    post = postar(aluno, chave_post)
    responder(aluno, post, nova(), op=chave_post)  # prova que é quem abriu
    responder(aluno, post, nova())  # outra pessoa
    responder(aluno, post, nova(), op=nova())  # chave errada
    respostas = aluno.get(f"/forum/{post}").json()["replies"]
    assert [r["by_author"] for r in respostas] == [True, False, False]


def test_o_servidor_nao_devolve_mine_sem_a_chave_na_leitura(aluno):
    chave = nova()
    post = postar(aluno, chave)
    # leitura sem a chave: o navegador é quem sabe quais são suas (guarda as chaves)
    assert aluno.get(f"/forum/{post}").json()["mine"] is False
    assert (
        aluno.get(f"/forum/{post}", headers={"X-Followw-Author": chave}).json()["mine"]
        is True
    )


def test_material_so_e_apagado_por_quem_tem_a_chave_dele(aluno):
    chave = nova()
    enviado = enviar(aluno, chave, (1, 2, 3))
    assert enviado.status_code == 201, enviado.text
    material = enviado.headers["X-Created-Id"]
    assert enviado.json()["id"] == material
    outra = nova()
    # outro material do mesmo "aluno" com outra chave: sem vínculo entre os dois
    assert enviar(aluno, outra, (3, 2, 1)).status_code == 201
    assert (
        aluno.delete(
            f"/materials/FGA0030/{material}", headers={"X-Followw-Author": outra}
        ).status_code
        == 404
    )
    assert (
        aluno.delete(
            f"/materials/FGA0030/{material}", headers={"X-Followw-Author": chave}
        ).status_code
        == 204
    )


def test_guia_nao_tem_limite_por_pessoa_e_sim_por_origem(aluno, database):
    corpo = {
        "title": "Como pedir dispensa de estágio",
        "summary": "O que juntar e para quem mandar o pedido de dispensa.",
        "body": "Primeiro confira o regulamento do curso. " * 5,
        "category": "estagio",
    }
    codigos = [
        aluno.post(
            "/tutorials", json=corpo, headers={"X-Followw-Author": nova()}
        ).status_code
        for _ in range(4)
    ]
    assert codigos == [201, 201, 201, 429]
    with database() as session:
        chaves = [
            r for (r,) in session.execute(text("SELECT author_key FROM tutorials"))
        ]
    assert len(chaves) == len(set(chaves)) == 3


def test_publicar_exige_chave_valida(aluno):
    corpo = {"kind": "duvida", "title": "Título bom", "body": "texto"}
    assert aluno.post("/forum", json=corpo).status_code == 400
    assert (
        aluno.post(
            "/forum", json=corpo, headers={"X-Followw-Author": "curta"}
        ).status_code
        == 400
    )


def test_chaves_nao_aparecem_nos_logs(aluno, caplog):
    chave = nova()
    with caplog.at_level(logging.DEBUG):
        postar(aluno, chave)
    assert chave not in caplog.text and resource_key(chave) not in caplog.text


def test_resposta_publica_nao_traz_verificadores(aluno):
    chave = nova()
    post = postar(aluno, chave)
    responder(aluno, post, nova())
    texto = aluno.get(f"/forum/{post}").text + aluno.get("/forum").text
    assert resource_key(chave) not in texto and "author_key" not in texto


# ---------------------------------------------------------------- migração do esquema antigo


def legado(database, segredo):
    """Linhas como o esquema antigo as gravava: verificador derivado do segredo do aparelho por escopo."""
    post_id, outro_id = uuid.uuid4(), uuid.uuid4()
    with database.begin() as session:
        session.add(
            ForumPost(
                id=post_id,
                kind="duvida",
                title="Antiga",
                body="x",
                author_key=anonymous_key(segredo, f"forum:{post_id}"),
            )
        )
        session.add(
            ForumPost(
                id=outro_id,
                kind="duvida",
                title="De outra pessoa",
                body="x",
                author_key=anonymous_key(nova(), f"forum:{outro_id}"),
            )
        )
    return post_id, outro_id


def escopo_do_forum(post_id):
    from api.modules.forum.service import _scope

    return _scope(post_id)


def test_migracao_troca_a_autoria_antiga_por_chaves_independentes(aluno, database):
    segredo = nova()
    post_id = uuid.uuid4()
    outro_id = uuid.uuid4()
    with database.begin() as session:
        session.add(
            ForumPost(
                id=post_id,
                kind="duvida",
                title="Antiga",
                body="x",
                author_key=anonymous_key(segredo, escopo_do_forum(post_id)),
            )
        )
        session.add(
            ForumPost(
                id=outro_id,
                kind="duvida",
                title="Alheia",
                body="x",
                author_key=anonymous_key(nova(), escopo_do_forum(outro_id)),
            )
        )
        session.add(
            ForumReply(
                post_id=post_id,
                body="minha",
                author_key=anonymous_key(segredo, escopo_do_forum(post_id)),
            )
        )
        session.add(
            Tutorial(
                title="g",
                summary="s",
                body="b",
                category="estagio",
                author_key=anonymous_key(segredo, "tutorials"),
                status="pending",
            )
        )
    # com o segredo antigo ainda dá para gerenciar (compatibilidade)
    assert (
        aluno.get(f"/forum/{post_id}", headers={"X-Followw-Author": segredo}).json()[
            "mine"
        ]
        is True
    )

    migrado = aluno.post("/community/migrate", headers={"X-Followw-Author": segredo})
    assert migrado.status_code == 200, migrado.text
    itens = migrado.json()["items"]
    assert sorted(i["kind"] for i in itens) == ["post", "reply", "tutorial"]
    chaves = {i["kind"]: i["key"] for i in itens}
    assert len({i["key"] for i in itens}) == 3  # nenhuma chave repete

    # o segredo antigo deixou de valer; a chave nova vale
    assert (
        aluno.get(f"/forum/{post_id}", headers={"X-Followw-Author": segredo}).json()[
            "mine"
        ]
        is False
    )
    assert (
        aluno.get(
            f"/forum/{post_id}", headers={"X-Followw-Author": chaves["post"]}
        ).json()["mine"]
        is True
    )
    # a resposta no post que a pessoa abriu mantém o selo "quem abriu a conversa"
    assert [
        r["by_author"] for r in aluno.get(f"/forum/{post_id}").json()["replies"]
    ] == [True]
    with database() as session:
        valores = [
            v
            for (v,) in session.execute(
                text(
                    "SELECT author_key FROM forum_posts UNION ALL SELECT author_key FROM forum_replies UNION ALL SELECT author_key FROM tutorials"
                )
            )
        ]
    assert not any(
        v == anonymous_key(segredo, escopo_do_forum(post_id)) for v in valores
    )
    assert len(valores) == len(set(valores))
    # a publicação de outra pessoa não foi tocada
    assert (
        aluno.get(f"/forum/{outro_id}", headers={"X-Followw-Author": segredo}).json()[
            "mine"
        ]
        is False
    )
    # migrar de novo não acha mais nada
    assert (
        aluno.post("/community/migrate", headers={"X-Followw-Author": segredo}).json()[
            "items"
        ]
        == []
    )
    # e a chave nova gerencia: apagar
    assert (
        aluno.delete(
            f"/forum/{post_id}", headers={"X-Followw-Author": chaves["post"]}
        ).status_code
        == 204
    )


def test_migracao_tem_cota_e_exige_o_segredo(aluno):
    assert aluno.post("/community/migrate").status_code == 400
    codigos = [
        aluno.post(
            "/community/migrate", headers={"X-Followw-Author": nova()}
        ).status_code
        for _ in range(8)
    ]
    assert (
        codigos[:5] == [200] * 5 and 429 in codigos[5:]
    )  # a cota inclui o pedido recusado acima


def test_material_antigo_continua_gerenciavel_ate_migrar(aluno, database):
    segredo = nova()
    from api.modules.materials.service import _scope

    with database.begin() as session:
        session.add(
            Material(
                subject_code="FGA0030",
                semester="2026.1",
                title="Velho",
                kind="lista",
                filename="a.png",
                mime="image/png",
                size=1,
                sha256="0" * 64,
                storage_key="legado",
                professors=[],
                uploader_key=anonymous_key(segredo, _scope("FGA0030")),
            )
        )
        material = session.execute(text("SELECT id FROM materials")).scalar_one()
    assert (
        aluno.get("/materials/FGA0030", headers={"X-Followw-Author": segredo}).json()[
            "items"
        ][0]["mine"]
        is True
    )
    itens = aluno.post(
        "/community/migrate", headers={"X-Followw-Author": segredo}
    ).json()["items"]
    assert [i["kind"] for i in itens] == ["material"] and itens[0]["id"] == str(
        material
    )
    assert (
        aluno.get("/materials/FGA0030", headers={"X-Followw-Author": segredo}).json()[
            "items"
        ][0]["mine"]
        is False
    )
