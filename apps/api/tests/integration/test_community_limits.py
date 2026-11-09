import pytest

from api.community_limits import CommunityLimits

from . import test_admin_security as admin
from . import test_materials as materials

owner, roles = admin.owner, admin.roles
materia, logado = materials.materia, materials.logado


def test_limites_admin_sao_aplicados_sem_apagar_material(
    owner, materia, client, cookies
):
    defaults = client.get("/admin/api/limits", headers=admin.HEADERS).json()
    assert defaults == CommunityLimits().model_dump()
    changed = {**defaults, "materials_per_subject": 1, "forum_replies": 1}
    assert (
        client.put("/admin/api/limits", json=changed, headers=admin.HEADERS).status_code
        == 200
    )
    logs = client.get(
        "/admin/api/log", params={"action": "community.limits"}, headers=admin.HEADERS
    ).json()
    assert logs["total"] == 1
    from sigaa_client import Credentials

    client.cookies.clear()
    client.cookies.update(
        cookies(refresh=Credentials(registration="251000000", password="sintetica123"))
    )
    assert client.get(materials.URL).json()["limits"]["max_per_subject"] == 1
    first = materials._enviar(client, materials._png()).json()
    assert materials._enviar(client, materials._png((1, 2, 3))).status_code == 409
    assert client.get(f"{materials.URL}/{first['id']}").status_code == 200
    post = client.post(
        "/forum",
        json={
            "kind": "duvida",
            "title": "Limites configurados",
            "body": "Dúvida sintética",
        },
    ).json()
    assert (
        client.post(
            f"/forum/{post['id']}/replies", json={"body": "Primeira"}
        ).status_code
        == 201
    )
    assert (
        client.post(
            f"/forum/{post['id']}/replies", json={"body": "Segunda"}
        ).status_code
        == 409
    )


@pytest.mark.parametrize(
    "cargo,status", [("moderator", 403), ("administrator", 200), ("owner", 200)]
)
def test_limites_exigem_permissao_de_configuracao(roles, cargo, status):
    client, cookies, _ = roles
    client.cookies.clear()
    client.cookies.update(cookies[cargo])
    assert client.get("/admin/api/limits", headers=admin.HEADERS).status_code == status
    assert (
        client.put(
            "/admin/api/limits",
            json=CommunityLimits().model_dump(),
            headers=admin.HEADERS,
        ).status_code
        == status
    )


@pytest.mark.parametrize(
    "body",
    [
        {"forum_replies": 501},
        {"materials_file_mb": 21},
        {"materials_subject_mb": 0},
        {"forum_replies": "10"},
        {"terminal": "comando"},
    ],
)
def test_painel_nao_aumenta_tetos_nem_aceita_campos_livres(owner, client, body):
    assert (
        client.put("/admin/api/limits", json=body, headers=admin.HEADERS).status_code
        == 422
    )
