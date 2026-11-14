import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from api.db.context import use_context
from api.db.main import Database
from api.db.models import AdminLog, ForumPost, Report, Tutorial
from api.modules.admin import moderation

from . import test_admin_security as admin

owner, roles = admin.owner, admin.roles


def guia_pendente(database):
    with database.begin() as session:
        guia = Tutorial(
            title="Guia sintético",
            summary="Orientação para teste",
            body="Conteúdo público sintético",
            category="matricula",
            status="pending",
            author_key=None,
        )
        session.add(guia)
        session.flush()
        return guia.id


@pytest.mark.parametrize("em_lote", [False, True])
@pytest.mark.parametrize("acao", ["accept", "reject"])
def test_guia_decidido_retorna_409_sem_alterar_decisao_ou_auditoria(
    owner, client, database, em_lote, acao
):
    id_ = guia_pendente(database)
    path = f"/admin/api/tutorials/{id_}"
    body = {"action": acao, "reason": "Decisão inicial conferida"}
    response = client.post(
        "/admin/api/moderation/batch" if em_lote else path,
        headers=admin.HEADERS,
        json={**body, "kind": "tutorial", "ids": [str(id_)]} if em_lote else body,
    )
    assert response.status_code == (200 if em_lote else 204)
    with database() as session:
        aprovado_em = session.get(Tutorial, id_).approved_at
    for tentativa in ("accept", "reject"):
        assert (
            client.post(
                path,
                headers=admin.HEADERS,
                json={"action": tentativa, "reason": "Fila desatualizada"},
            ).status_code
            == 409
        )
    with database() as session:
        guia = session.get(Tutorial, id_)
        assert guia.status == ("approved" if acao == "accept" else "rejected")
        assert guia.approved_at == aprovado_em
        logs = list(
            session.scalars(select(AdminLog).where(AdminLog.target_id == str(id_)))
        )
        assert len(logs) == 1
        assert logs[0].action == f"tutorial.{acao}"
        assert logs[0].detail == body["reason"]


def test_decisao_de_guia_inexistente_retorna_404(owner, client):
    assert (
        client.post(
            f"/admin/api/tutorials/{uuid4()}",
            headers=admin.HEADERS,
            json={"action": "accept", "reason": "Guia inexistente"},
        ).status_code
        == 404
    )


@pytest.mark.parametrize("segunda_em_lote", [False, True])
async def test_decisoes_concorrentes_de_guia_gravam_so_uma_decisao_e_auditoria(
    async_database, database, monkeypatch, segunda_em_lote
):
    id_ = guia_pendente(database)
    primeira_decidindo = asyncio.Event()
    segunda_decidindo = asyncio.Event()
    segunda_iniciou = asyncio.Event()
    liberar = asyncio.Event()
    decide = moderation.decide

    async def decidir(*args, **kwargs):
        if primeira_decidindo.is_set():
            segunda_decidindo.set()
        else:
            primeira_decidindo.set()
        await liberar.wait()
        return await decide(*args, **kwargs)

    monkeypatch.setattr(moderation, "decide", decidir)
    request = SimpleNamespace(state=SimpleNamespace(admin=None))
    db = Database(async_database)

    async def segunda_decisao():
        segunda_iniciou.set()
        try:
            if segunda_em_lote:
                await moderation.batch(
                    moderation.BatchDecision(
                        kind="tutorial",
                        ids=[id_],
                        action="reject",
                        reason="Outra decisão",
                    ),
                    request,
                    db,
                )
            else:
                await moderation.decide_tutorial(
                    id_,
                    moderation.Decision(action="reject", reason="Outra decisão"),
                    request,
                    db,
                )
        except HTTPException as error:
            return error.status_code
        return 204

    with use_context(scope="admin"):
        primeira = asyncio.create_task(
            moderation.decide_tutorial(
                id_,
                moderation.Decision(action="accept", reason="Primeira decisão"),
                request,
                db,
            )
        )
        segunda = None
        try:
            await asyncio.wait_for(primeira_decidindo.wait(), 5)
            segunda = asyncio.create_task(segunda_decisao())
            await asyncio.wait_for(segunda_iniciou.wait(), 5)
            with pytest.raises(TimeoutError):
                await asyncio.wait_for(segunda_decidindo.wait(), 0.2)
        finally:
            liberar.set()
            results = await asyncio.wait_for(
                asyncio.gather(primeira, *([segunda] if segunda else [])), 5
            )
        assert results == [None, 409]
    with database() as session:
        assert session.get(Tutorial, id_).status == "approved"
        logs = list(
            session.scalars(select(AdminLog).where(AdminLog.target_id == str(id_)))
        )
        assert [log.action for log in logs] == ["tutorial.accept"]


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
