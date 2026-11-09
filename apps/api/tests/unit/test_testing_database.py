import pytest

from api.testing_database import require_test_database


@pytest.mark.parametrize(
    "name",
    ["followw", "postgres", "production", None, "followw_test;DROP", "followw_tests"],
)
def test_banco_real_ou_nome_ambiguo_e_recusado(name):
    with pytest.raises(ValueError, match="nenhum dado foi alterado"):
        require_test_database(name)


@pytest.mark.parametrize("name", ["followw_test", "followw_test_abc_gw0"])
def test_aceita_somente_banco_exclusivo_de_testes(name):
    require_test_database(name)
