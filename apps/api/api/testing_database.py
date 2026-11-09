"""Barreira para ferramentas de teste que limpam tabelas; não participa das rotas da API."""

import re


def require_test_database(database: str | None) -> None:
    if not database or not re.fullmatch(r"followw_test(?:_[a-z0-9_]+)?", database):
        raise ValueError(
            "Testes exigem um banco exclusivo followw_test; nenhum dado foi alterado."
        )
