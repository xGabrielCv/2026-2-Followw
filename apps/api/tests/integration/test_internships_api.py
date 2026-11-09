"""Mural de estágios: lido do SIGAA na hora, sem gravação."""

from datetime import datetime
from decimal import Decimal

from pydantic import SecretStr
from sigaa_client import (
    Credentials,
    Internship,
    InternshipCourse,
    InternshipGrantor,
    InternshipNotFound,
    InternshipSummary,
)

ANA = Credentials(registration="251000000", password=SecretStr("senha123"))
MEU = "listagem_meu_curso:0:" + "a" * 64
OUTRO = "listagem_outros_cursos:3:" + "b" * 64


def _resumo(reference, title, stipend):
    return InternshipSummary(
        reference=reference,
        title=title,
        vacancies=2,
        stipend=stipend,
        published_until=datetime(2026, 12, 1, 18),
    )


def test_lista_marca_as_do_curso_e_exige_login(client, cookies, stub_sigaa, database):
    assert client.get("/internships").status_code == 401
    stub_sigaa.internships.list_internships.return_value = [
        _resumo(MEU, "Estágio em software", Decimal("1200.00")),
        _resumo(OUTRO, "Estágio em direito", None),
    ]
    client.cookies.update(cookies(refresh=ANA))
    lista = client.get("/internships").json()
    assert [(i["title"], i["mine"], i["stipend"]) for i in lista] == [
        ("Estágio em software", True, "1200.00"),
        ("Estágio em direito", False, None),
    ]
    client.get("/internships", params={"scope": "mine"})
    stub_sigaa.internships.list_internships.assert_awaited_with(only_my_course=True)
    assert client.get("/internships", params={"scope": "x"}).status_code == 422


def test_detalhe_pela_referencia_e_mural_mudado_e_404(client, cookies, stub_sigaa):
    client.cookies.update(cookies(refresh=ANA))
    stub_sigaa.internships.get_internship.return_value = Internship(
        title="Estágio em software",
        vacancies=2,
        stipend=Decimal("1200.00"),
        transport_allowance=None,
        published_from=datetime(2026, 11, 1),
        published_until=datetime(2026, 12, 1),
        sigaa_enrollment=True,
        attachment=None,
        grantor=InternshipGrantor(
            agreement_type="Convênio",
            cnpj="00.000.000/0001-00",
            name="Empresa",
            responsibles=(),
        ),
        courses=(
            InternshipCourse(
                name="ENGENHARIA DE SOFTWARE", unit="FCTE", degree="Bacharelado"
            ),
        ),
        description="Trabalhar com **Python**.",
    )
    detalhe = client.get(f"/internships/{MEU}")
    assert detalhe.status_code == 200
    assert detalhe.json()["grantor"]["name"] == "Empresa"
    assert client.get("/internships/qualquer-coisa").status_code == 422
    stub_sigaa.internships.get_internship.side_effect = InternshipNotFound("mudou")
    assert client.get(f"/internships/{OUTRO}").status_code == 404
