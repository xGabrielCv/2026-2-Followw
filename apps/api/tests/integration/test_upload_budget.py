import secrets
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

import pytest
from PIL import Image
from sigaa_client import Credentials
from sqlalchemy import select

from api.core.config import settings
from api.db.models import Material, Subject
from api.modules.community.models import UploadBudget

CODE = "FGA0001"
KEY = "c" * 64


@pytest.fixture
def browser(client, cookies, database, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "materials_dir", str(tmp_path))
    with database.begin() as session:
        session.add_all(
            [
                Subject(code=CODE, name="MATÉRIA SINTÉTICA"),
                Subject(code="FGA0002", name="OUTRA MATÉRIA"),
            ]
        )
    client.cookies.update(
        cookies(refresh=Credentials(registration="251000001", password="sintetica123"))
    )
    return client


def grant(client, code=CODE, key=KEY):
    return client.post(
        "/auth/community-permits",
        json={"method": "POST", "path": f"/materials/{code}", "upload_key": key},
    )


def upload(client, token, number):
    output = BytesIO()
    Image.new("RGB", (2, 2), (number, 1, 2)).save(output, format="PNG")
    return client.post(
        f"/materials/{CODE}",
        headers={
            "cookie": "",
            "X-Followw-Permit": token,
            "X-Followw-Author": secrets.token_hex(32),
        },
        files={"file": ("arquivo.png", output.getvalue(), "image/png")},
        data={"title": "Resumo de conteúdo", "kind": "resumo", "semester": "2026.2"},
    )


def test_uma_a_dez_autorizacoes_enviam_arquivos_independentes_e_decima_primeira_e_recusada(
    browser, database
):
    tokens = []
    for index in range(10):
        response = grant(browser)
        assert response.status_code == 200
        token = response.json()["token"]
        tokens.append(token)
        assert upload(browser, token, index).status_code == 201
    assert len(set(tokens)) == 10
    assert grant(browser).status_code == 429
    with database() as session:
        rows = session.scalars(select(Material)).all()
        budgets = session.scalars(select(UploadBudget)).all()
    assert len(rows) == len({row.uploader_key for row in rows}) == 10
    assert len(budgets) == 1 and budgets[0].count == 10
    assert not (
        {"quota", "budget", "registration", "student_id"}
        & set(Material.__table__.columns.keys())
    )


def test_outras_materias_tem_cota_independente_sem_identificador_comum(
    browser, database
):
    for _ in range(10):
        assert grant(browser).status_code == 200
    assert grant(browser).status_code == 429
    assert grant(browser, code="FGA0002").status_code == 200
    with database() as session:
        rows = session.scalars(select(UploadBudget)).all()
    assert len({row.digest for row in rows}) == 2
    assert set(UploadBudget.__table__.columns.keys()) == {
        "digest",
        "count",
        "expires_at",
    }


def test_logout_e_login_nao_reiniciam_cota_da_mesma_credencial(browser, cookies):
    for _ in range(10):
        assert grant(browser).status_code == 200
    browser.cookies.clear()
    assert grant(browser).status_code == 401
    browser.cookies.update(
        cookies(refresh=Credentials(registration="251000002", password="sintetica456"))
    )
    assert grant(browser).status_code == 429
    # Limitação explícita: navegador novo não é reconhecido como a mesma pessoa.
    assert grant(browser, key=secrets.token_hex(32)).status_code == 200


def test_concorrencia_na_ultima_vaga_nao_excede_dez(browser):
    for _ in range(9):
        assert grant(browser).status_code == 200
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = sorted(pool.map(lambda _: grant(browser).status_code, range(2)))
    assert statuses == [200, 429]


def test_mesmo_comprovante_nao_pode_enviar_dois_arquivos(browser):
    token = grant(browser).json()["token"]
    assert upload(browser, token, 1).status_code == 201
    assert upload(browser, token, 2).status_code == 403


def test_parametros_fora_do_escopo_nao_emitem_autorizacao(browser):
    assert (
        browser.post(
            "/auth/community-permits",
            json={"method": "POST", "path": f"/materials/{CODE}"},
        ).status_code
        == 422
    )
    assert (
        browser.post(
            "/auth/community-permits",
            json={"method": "POST", "path": "/reviews", "upload_key": KEY},
        ).status_code
        == 422
    )
    assert grant(browser, key="matricula-nao-e-chave").status_code == 422
    assert grant(browser, code="ABC9999").status_code == 404


def test_limite_diario_configurado_pelo_painel_e_aplicado_e_nunca_passa_de_dez(
    browser, database
):
    from api.community_limits import KEY as LIMITS_KEY
    from api.community_limits import CommunityLimits
    from api.db.models import SystemText

    with database.begin() as session:
        session.add(
            SystemText(
                key=LIMITS_KEY,
                value=CommunityLimits(upload_attempts_per_day=2).model_dump_json(),
            )
        )
    assert grant(browser).status_code == 200
    assert grant(browser).status_code == 200
    recusada = grant(browser)
    assert recusada.status_code == 429
    assert "2 autorizações" in recusada.json()["detail"]
    assert (
        browser.get(f"/materials/{CODE}").json()["limits"]["max_daily_upload_attempts"]
        == 2
    )
    # o teto de segurança continua sendo 10: o painel não passa disso
    with pytest.raises(ValueError):
        CommunityLimits(upload_attempts_per_day=11)
