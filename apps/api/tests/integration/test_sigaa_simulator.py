import asyncio

import httpx
import pytest
import respx
from sigaa_client import AuthenticationFailed, Credentials, SigaaClient

from loadtest.sigaa import SimulatedSigaa


@pytest.fixture
def simulated():
    fake = SimulatedSigaa()
    with respx.mock(assert_all_called=False) as router:
        router.route(host__in=["sigaa.unb.br", "autenticacao.unb.br"]).mock(
            side_effect=fake
        )
        yield fake


async def test_simulador_exercita_parsers_login_turmas_notas_frequencia_e_noticias(
    simulated,
):
    async with SigaaClient(
        credentials=Credentials(registration="251000000", password="simulada123")
    ) as client:
        profile = await client.profile.get_profile()
        assert profile.name == "ALUNA SIMULADA A"
        assert profile.registration == "251000000"
        classrooms = await client.classrooms.list_classrooms()
        assert [(item.id, item.current) for item in classrooms] == [
            ("AAA", True),
            ("BBB", False),
        ]
        grades = await client.classrooms.list_grades()
        assert grades[0].subject_code == "FGA0158" and grades[0].grade == "MS"
        frequency = await client.classrooms.get_classroom_frequency("AAA")
        assert frequency.frequency.attended == 22
        assert frequency.frequency.entries[1].absences == 2
        news = await client.classrooms.list_classroom_news("AAA")
        assert news[0].id == 42
        detail = await client.classrooms.get_classroom_news("AAA", 42)
        assert "simulado" in detail.content
        members = await client.classrooms.list_classroom_members("AAA")
        assert members[0].name == "DOCENTE SINTÉTICO"
        posts = await client.classrooms.list_classroom_posts("AAA")
        assert posts
        await client.logout()
        assert not simulated.sessions


async def test_simulador_isola_contas_e_recupera_expiracao(simulated):
    async def read(registration):
        async with SigaaClient(
            credentials=Credentials(registration=registration, password="simulada123")
        ) as client:
            first = await client.profile.get_profile()
            simulated.expire(registration)
            second = await client.profile.get_profile()
            assert first.registration == second.registration == registration
            return first.name

    names = await asyncio.gather(read("251000000"), read("252000000"))
    assert names == ["ALUNA SIMULADA A", "ALUNO SIMULADO B"]
    assert simulated.calls["logins"] >= 3


async def test_simulador_senha_invalida_timeout_e_recuperacao(simulated):
    async with SigaaClient(
        credentials=Credentials(registration="251000000", password="invalida")
    ) as client:
        with pytest.raises(AuthenticationFailed):
            await client.authenticate()
    simulated.mode = "timeout"
    async with SigaaClient(
        credentials=Credentials(registration="251000000", password="simulada123")
    ) as client:
        with pytest.raises(httpx.ReadTimeout):
            await client.profile.get_profile()
        simulated.mode = "normal"
        assert (await client.profile.get_profile()).registration == "251000000"


def test_api_real_usa_simulador_sem_persistir_perfil(client, simulated, database):
    response = client.post(
        "/auth/sigaa", json={"registration": "251000000", "password": "simulada123"}
    )
    assert response.status_code == 200
    assert client.get("/me").json()["name"] == "ALUNA SIMULADA A"
    before = simulated.calls["requests"]
    assert client.get("/me").status_code == 200
    assert simulated.calls["requests"] == before
    classrooms = client.get("/classrooms")
    assert classrooms.status_code == 200, classrooms.text
