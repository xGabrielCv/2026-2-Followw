"""Carga só usa banco e papel descartáveis no próprio computador."""

import re
from collections.abc import Mapping
from urllib.parse import urlsplit


def validate_environment(env: Mapping[str, str]) -> None:
    url = urlsplit(env.get("DATABASE_URL", ""))
    database = url.path.removeprefix("/")
    if (
        env.get("ENVIRONMENT") != "testing"
        or not re.fullmatch(r"followw_load_[a-f0-9]{12}", database)
        or url.hostname not in {"127.0.0.1", "::1", "localhost"}
        or url.username != database
        or env.get("APP_DB_ROLE") != database
    ):
        raise RuntimeError(
            "Carga exige banco e papel sintéticos exclusivos em loopback."
        )
