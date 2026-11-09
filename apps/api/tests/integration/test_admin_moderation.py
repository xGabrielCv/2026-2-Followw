from uuid import uuid4

import pytest

from api.db.models import ForumPost, Report, Tutorial

from . import test_admin_security as admin

owner, roles = admin.owner, admin.roles


def seed(database, count=2):
    posts, reports = [], []
    with database.begin() as session:
        for number in range(count):
            post = ForumPost(
                kind="post",
                title=f"Publicação sintética {number}",
                body="Conteúdo para teste",
                author_key=None,
            )
            session.add(post)
            session.flush()
            report = Report(target_type="post", target_id=post.id, reason="spam")
            session.add(report)
            session.flush()
            posts.append(post.id)
            reports.append(report.id)
    return posts, reports


def test_lote_invalido_reverte_tudo_e_lote_valido_registra_motivo(
    owner, client, database
):
    posts, reports = seed(database)
    body = {
        "kind": "report",
        "action": "accept",
        "reason": "Duplicata e spam conferidos",
        "ids": [str(reports[0]), str(uuid4())],
    }
    assert (
        client.post(
            "/admin/api/moderation/batch", headers=admin.HEADERS, json=body
        ).status_code
        == 404
    )
    with database() as session:
        assert all(session.get(ForumPost, id_) is not None for id_ in posts)
        assert all(session.get(Report, id_).status == "pending" for id_ in reports)
    body["ids"] = [str(id_) for id_ in reports]
    assert client.post(
        "/admin/api/moderation/batch", headers=admin.HEADERS, json=body
    ).json() == {"processed": 2}
    with database() as session:
        assert all(session.get(ForumPost, id_) is None for id_ in posts)
    accepted = client.get(
        "/admin/api/reports",
        headers=admin.HEADERS,
        params={
            "status": "accepted",
            "reason": "spam",
            "target": "post",
            "page_size": 1,
        },
    ).json()
    assert accepted["total"] == 2 and len(accepted["items"]) == 1
    assert accepted["items"][0]["history"][0]["reason"] == body["reason"]
    assert (
        client.post(
            "/admin/api/moderation/batch", headers=admin.HEADERS, json=body
        ).status_code
        == 409
    )


def test_decisao_individual_exige_justificativa_e_nao_redecide_fila_concluida(
    owner, client, database
):
    _, reports = seed(database, 1)
    path = f"/admin/api/reports/{reports[0]}"
    assert (
        client.post(path, headers=admin.HEADERS, json={"action": "reject"}).status_code
        == 422
    )
    assert (
        client.post(
            path, headers=admin.HEADERS, json={"action": "reject", "reason": "ok"}
        ).status_code
        == 422
    )
    assert (
        client.post(
            path,
            headers=admin.HEADERS,
            json={"action": "reject", "reason": "Conteúdo permitido"},
        ).status_code
        == 204
    )
    assert (
        client.post(
            path,
            headers=admin.HEADERS,
            json={"action": "accept", "reason": "Decisão concorrente"},
        ).status_code
        == 409
    )


@pytest.mark.parametrize(
    "ids", [[], [str(uuid4())] * 2, [str(uuid4()) for _ in range(21)]]
)
def test_lotes_repetidos_vazios_ou_grandes_sao_recusados(owner, client, ids):
    assert (
        client.post(
            "/admin/api/moderation/batch",
            headers=admin.HEADERS,
            json={
                "kind": "report",
                "action": "reject",
                "reason": "Decisão sintética",
                "ids": ids,
            },
        ).status_code
        == 422
    )


def test_busca_decifra_so_no_servidor_e_ordena_as_filas(owner, client, database):
    from datetime import UTC, datetime, timedelta

    posts, reports = seed(database)
    with database.begin() as session:
        for index, id_ in enumerate(reports):
            report = session.get(Report, id_)
            report.message = (
                "Mensagem com revisão necessária" if index == 0 else "Outro conteúdo"
            )
            report.created_at = datetime.now(UTC) + timedelta(seconds=index)
        session.add(
            Tutorial(
                title="Matrícula sintética",
                summary="Orientação sintética da comunidade",
                body="Texto sintético sem identificação" * 3,
                category="matricula",
                status="pending",
                author_key=None,
            )
        )
    oldest = client.get("/admin/api/reports?order=oldest", headers=admin.HEADERS).json()
    newest = client.get("/admin/api/reports?order=newest", headers=admin.HEADERS).json()
    assert oldest["items"][0]["id"] == str(reports[0])
    assert newest["items"][0]["id"] == str(reports[1])
    found = client.get("/admin/api/reports?q=revisao", headers=admin.HEADERS).json()
    assert found["total"] == 1 and found["items"][0]["id"] == str(reports[0])
    assert not found["search_limited"]
    assert (
        client.get(
            "/admin/api/reports", params={"q": str(posts[1])}, headers=admin.HEADERS
        ).json()["total"]
        == 1
    )
    guides = client.get(
        "/admin/api/tutorials?q=matricula", headers=admin.HEADERS
    ).json()
    assert guides["total"] == 1
    assert (
        client.get("/admin/api/tutorials?q=inexistente", headers=admin.HEADERS).json()[
            "items"
        ]
        == []
    )
    assert (
        client.get(
            "/admin/api/reports?order=invalida", headers=admin.HEADERS
        ).status_code
        == 422
    )
