import pytest

from loadtest.safety import validate_environment


def test_carga_so_aceita_banco_papel_e_ambiente_sinteticos():
    name = "followw_load_012345abcdef"
    valid = {
        "ENVIRONMENT": "testing",
        "DATABASE_URL": f"postgresql+asyncpg://{name}:senha@127.0.0.1:5432/{name}",
        "APP_DB_ROLE": name,
    }
    validate_environment(valid)
    for patch in [
        {"ENVIRONMENT": "production"},
        {"APP_DB_ROLE": "followw_app"},
        {"DATABASE_URL": "postgresql://postgres@127.0.0.1/followw"},
        {"DATABASE_URL": f"postgresql://{name}:senha@servidor-externo/{name}"},
        {"DATABASE_URL": f"postgresql://postgres@127.0.0.1/{name}"},
    ]:
        with pytest.raises(RuntimeError, match="sintéticos"):
            validate_environment({**valid, **patch})
