from concurrent.futures import ThreadPoolExecutor

import pytest
from joserfc import jwt
from sigaa_client import Credentials
from sqlalchemy import select

from api.modules.community import permissions
from api.modules.community.models import UsedCommunityPermission

BODY = {
    "kind": "duvida",
    "title": "Como estudar o conteúdo?",
    "body": "Aceito sugestões de materiais públicos.",
}
KEY = "b" * 64


def prepare(client, cookies):
    client.cookies.update(
        cookies(refresh=Credentials(registration="251000001", password="sintetica123"))
    )
    response = client.post(
        "/auth/community-permits", json={"method": "POST", "path": "/forum"}
    )
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    return response.json()["token"]


def publish(client, token, **extra):
    return client.post(
        "/forum",
        json=BODY,
        headers={
            "cookie": "",
            "X-Followw-Permit": token,
            "X-Followw-Author": KEY,
            **extra,
        },
    )


def test_emissao_exige_sessao_e_nao_inclui_identidade_ou_chave_de_autoria(
    client, cookies
):
    assert (
        client.post(
            "/auth/community-permits", json={"method": "POST", "path": "/forum"}
        ).status_code
        == 401
    )
    token = prepare(client, cookies)
    claims = jwt.decode(token, permissions._key(), algorithms=["HS256"]).claims
    assert set(claims) == {"aud", "act", "iat", "exp", "jti"}
    assert claims["exp"] - claims["iat"] == 120
    assert "251000001" not in str(claims) and KEY not in str(claims)
    assert publish(client, token).status_code == 201


def test_cookie_academico_na_publicacao_e_recusado_mesmo_com_comprovante(
    client, cookies
):
    token = prepare(client, cookies)
    assert publish(client, token, cookie="refresh_token=sintetico").status_code == 400
    assert publish(client, token).status_code == 201


def test_uso_unico_e_escopo_exato_de_metodo_e_recurso(client, cookies):
    token = prepare(client, cookies)
    wrong = client.post(
        "/tutorials",
        json={},
        headers={"cookie": "", "X-Followw-Permit": token, "X-Followw-Author": KEY},
    )
    assert wrong.status_code == 403
    assert publish(client, token).status_code == 201
    assert publish(client, token).status_code == 403


def test_replay_concorrente_so_cria_uma_publicacao(client, cookies):
    token = prepare(client, cookies)
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = sorted(
            pool.map(lambda _: publish(client, token).status_code, range(2))
        )
    assert statuses == [201, 403]


def test_comprovante_vencido_e_assinatura_alterada_nao_autorizam(
    client, cookies, monkeypatch
):
    token = prepare(client, cookies)
    header, payload, signature = token.split(".")
    bad = (
        header
        + "."
        + payload
        + "."
        + ("a" if signature[0] != "a" else "b")
        + signature[1:]
    )
    assert publish(client, bad).status_code == 403
    with monkeypatch.context() as patch:
        patch.setattr(
            permissions.time,
            "time",
            lambda: (
                jwt.decode(token, permissions._key(), algorithms=["HS256"]).claims[
                    "exp"
                ]
                + 1
            ),
        )
        assert publish(client, token).status_code == 403


@pytest.mark.parametrize(
    "path",
    [
        "/admin/api/accounts",
        "/auth/sigaa",
        "/forum?registration=1",
        "https://externo/forum",
        "/forum/../admin",
    ],
)
def test_nao_emite_para_destinos_fora_da_lista_fechada(client, cookies, path):
    prepare(client, cookies)
    assert (
        client.post(
            "/auth/community-permits", json={"method": "POST", "path": path}
        ).status_code
        == 422
    )


def test_replay_guarda_so_digest_e_validade_e_rls_recusa_leitura_fora_do_contexto(
    client, cookies, database
):
    token = prepare(client, cookies)
    assert publish(client, token).status_code == 201
    with database() as session:
        rows = session.scalars(select(UsedCommunityPermission)).all()
    assert len(rows) == 1
    assert set(UsedCommunityPermission.__table__.columns.keys()) == {
        "digest",
        "expires_at",
    }
    assert token not in str(rows[0].digest)
