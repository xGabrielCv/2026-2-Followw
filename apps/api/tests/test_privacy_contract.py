from api.crypto import Encrypted
from api.db.base import Base
from api.logger import event


def test_schema_nao_persiste_dados_academicos_individuais():
    forbidden = {
        "registration",
        "student_id",
        "student_name",
        "password",
        "access_token",
        "refresh_token",
        "session_token",
        "attendance",
        "individual_grade",
    }
    for table in Base.metadata.tables.values():
        columns = set(table.columns.keys())
        if table.name == "classroom_groups":
            assert isinstance(table.c.password.type, Encrypted)
            columns.discard("password")
        if table.name == "professor_reviews":
            # Critério público sobre o docente, não frequência individual do aluno.
            columns.discard("attendance")
        assert not (columns & forbidden), table.name
    assert not (
        {"students", "users", "profiles", "enrollments", "student_sessions"}
        & set(Base.metadata.tables)
    )


def test_erro_de_validacao_nao_repete_senha_ou_identificador(client, caplog):
    response = client.post(
        "/auth/sigaa",
        json={"registration": "identificador-sintetico-privado", "password": "x" * 100},
    )
    assert response.status_code == 422
    for value in ["identificador-sintetico-privado", "x" * 100]:
        assert value not in response.text
        assert value not in caplog.text
    assert all(
        "input" not in item and "ctx" not in item for item in response.json()["detail"]
    )


def test_log_recusa_campos_pessoais_e_payloads(caplog):
    event(
        "privacy.test",
        registration="aluno-sintetico",
        password="senha-sintetica",
        cookies={"value": "segredo"},
        payload="texto-academico",
        status_code=200,
    )
    for secret in ["aluno-sintetico", "senha-sintetica", "segredo", "texto-academico"]:
        assert secret not in caplog.text
    assert "200" in caplog.text


def test_rota_antiga_de_fila_nao_aceita_credenciais(client, qstash):
    response = client.post(
        "/jobs",
        json={"credentials": {"registration": "251000001", "password": "sintetica123"}},
    )
    assert response.status_code == 404
    assert not qstash.published


def test_login_sem_consentimento_nao_alimenta_contagem_de_uso(client, sigaa, database):
    from sqlalchemy import func, select

    from api.db.models import ActiveUser, SystemFlag

    with database.begin() as session:
        session.add(SystemFlag(key="telemetry", enabled=True))
    response = client.post(
        "/auth/sigaa", json={"registration": "251000000", "password": "senha123"}
    )
    assert response.status_code == 200
    with database() as session:
        assert session.scalar(select(func.count()).select_from(ActiveUser)) == 0
