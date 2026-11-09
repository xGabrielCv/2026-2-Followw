from datetime import UTC, datetime, timedelta

import pytest

from api.db.models import AdminLog

from . import test_admin_security as fixtures

HEADERS, owner, roles = fixtures.HEADERS, fixtures.owner, fixtures.roles


def test_auditoria_filtra_ordena_e_pagina_sem_perder_registros(roles, database):
    client, cookies, _ = roles
    client.cookies.clear()
    client.cookies.update(cookies["administrator"])
    base = datetime(2026, 11, 1, tzinfo=UTC)
    with database.begin() as session:
        session.add_all(
            [
                AdminLog(
                    action="synthetic-test",
                    target_type="post" if i % 2 else "material",
                    target_id=str(i),
                    actor_role="moderator",
                    detail="Justificativa sintética",
                    created_at=base + timedelta(minutes=i),
                )
                for i in range(27)
            ]
        )
    response = client.get(
        "/admin/api/log",
        headers=HEADERS,
        params={"action": "synthetic", "page_size": 10, "order": "oldest"},
    )
    assert response.status_code == 200
    result = response.json()
    assert result["total"] == 27 and len(result["items"]) == 10
    assert [item["target_id"] for item in result["items"]] == [
        str(i) for i in range(10)
    ]
    pages = [
        client.get(
            "/admin/api/log",
            headers=HEADERS,
            params={
                "action": "synthetic",
                "page_size": 10,
                "order": "oldest",
                "page": page,
            },
        ).json()
        for page in (1, 2, 3)
    ]
    assert len({item["target_id"] for page in pages for item in page["items"]}) == 27
    filtered = client.get(
        "/admin/api/log",
        headers=HEADERS,
        params={
            "action": "synthetic",
            "target": "post",
            "role": "moderator",
            "since": "2026-11-01",
            "until": "2026-11-01",
        },
    ).json()
    assert filtered["total"] == 13
    assert filtered["items"][0]["target_id"] == "25"
    assert (
        client.get(
            "/admin/api/log", headers=HEADERS, params={"actor": "inexistente"}
        ).json()["items"]
        == []
    )
    assert (
        client.get(
            "/admin/api/log",
            headers=HEADERS,
            params={"action": "synthetic", "since": "2026-11-02"},
        ).json()["total"]
        == 0
    )


@pytest.mark.parametrize(
    "params",
    [
        {"page": 0},
        {"page_size": 1000},
        {"order": "SQL"},
        {"since": "2026-11-02", "until": "2026-11-01"},
        {"unknown": "x"},
    ],
)
def test_auditoria_recusa_filtros_invalidos(owner, client, params):
    assert (
        client.get("/admin/api/log", headers=HEADERS, params=params).status_code == 422
    )


def test_moderador_nao_consulta_auditoria_mesmo_por_endpoint(roles):
    client, cookies, _ = roles
    client.cookies.clear()
    client.cookies.update(cookies["moderator"])
    assert client.get("/admin/api/log", headers=HEADERS).status_code == 403
