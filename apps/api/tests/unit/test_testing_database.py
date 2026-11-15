import importlib.util
from pathlib import Path

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


def e2e_cleanup():
    spec = importlib.util.spec_from_file_location(
        "e2e_cleanup", Path(__file__).parents[1] / "e2e_cleanup.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize(
    "name,owns", [("followw", "1"), ("followw_e2e_123456abcdef", "0")]
)
def test_limpeza_e2e_recusa_banco_real_ou_execucao_sem_posse(monkeypatch, name, owns):
    module = e2e_cleanup()
    monkeypatch.setenv("FOLLOWW_E2E_DATABASE", name)
    monkeypatch.setenv("FOLLOWW_E2E_OWNS_DATABASE", owns)
    monkeypatch.setattr(
        module.psycopg,
        "connect",
        lambda *_args, **_kwargs: pytest.fail("não deve conectar"),
    )
    with pytest.raises(SystemExit, match="não pertence"):
        module.cleanup()


@pytest.mark.parametrize("marker", ["outro banco", "followw:e2e:discardable"])
def test_limpeza_e2e_exige_marcador_antes_de_descartar(monkeypatch, marker):
    module = e2e_cleanup()
    commands = []

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def execute(self, query, params=None):
            commands.append(str(query))
            return self

        def fetchone(self):
            return (marker,) if len(commands) == 1 else None

    monkeypatch.setenv("FOLLOWW_E2E_DATABASE", "followw_e2e_123456abcdef")
    monkeypatch.setenv("FOLLOWW_E2E_OWNS_DATABASE", "1")
    monkeypatch.setattr(
        module.psycopg, "connect", lambda *_args, **_kwargs: Connection()
    )
    if marker != "followw:e2e:discardable":
        with pytest.raises(SystemExit, match="marcador"):
            module.cleanup()
        assert len(commands) == 1
    else:
        module.cleanup()
        assert "DROP DATABASE" in commands[1]
