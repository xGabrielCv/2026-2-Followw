"""Autoria por credencial aleatória de cada publicação.

Cada avaliação, resposta, material ou guia nasce com uma chave aleatória gerada no navegador, que a
guarda; o servidor guarda só um verificador (HMAC com chave do servidor). Não existe identificador do
aluno ou do aparelho reaproveitado entre publicações: duas publicações do mesmo aluno não têm nenhuma
relação matemática visível no banco. Linhas antigas (derivadas de um segredo do aparelho por escopo)
continuam verificáveis até serem migradas por `POST /community/migrate`.
"""

import hmac
import re
from typing import Annotated

from fastapi import Depends, Header, HTTPException

from api.cookies import derive_key

AUTHOR_HEADER = "X-Followw-Author"
_SECRET = re.compile(r"^[0-9a-f]{64}$")


def anonymous_key(author: str, scope: str) -> str:
    return hmac.digest(
        derive_key("followw:anonymous-author"),
        f"{scope}\x00{author}".encode(),
        "sha256",
    ).hex()


def same_key(stored: str, author: str | None, scope: str) -> bool:
    if not author:
        return False
    return hmac.compare_digest(stored, anonymous_key(author, scope))


def resource_key(key: str) -> str:
    """Verificador gravado no banco para uma credencial aleatória de publicação."""
    return anonymous_key(key, "resource")


def owns(stored: str | None, key: str | None, scope: str) -> bool:
    """Posse por credencial nova (aleatória) ou, em linhas legadas, pelo segredo derivado por escopo."""
    if not stored or not key:
        return False
    return hmac.compare_digest(stored, resource_key(key)) or same_key(
        stored, key, scope
    )


def valid_author(value: str | None) -> str | None:
    return value if value and _SECRET.fullmatch(value) else None


def optional_author(
    author: Annotated[
        str | None,
        # o app manda em toda requisição: fica fora do OpenAPI
        Header(alias=AUTHOR_HEADER, include_in_schema=False),
    ] = None,
) -> str | None:
    return valid_author(author)


OptionalAuthorDep = Annotated[str | None, Depends(optional_author)]


def require_author(author: OptionalAuthorDep) -> str:
    if author is None:
        raise HTTPException(
            400, "Atualize o app para publicar (falta a chave anônima)."
        )
    return author


AuthorDep = Annotated[str, Depends(require_author)]

USAGE_HEADER = "X-Followw-Usage"


def optional_usage(
    value: Annotated[
        str | None, Header(alias=USAGE_HEADER, include_in_schema=False)
    ] = None,
) -> dict[str, str] | None:
    """Três chaves aleatórias, uma para o dia, uma para a semana e uma para o mês, sem relação entre si."""
    parts = (value or "").split(",")
    if len(parts) != 3 or not all(valid_author(part) for part in parts):
        return None
    return dict(zip("dwm", parts, strict=True))


UsageDep = Annotated[dict[str, str] | None, Depends(optional_usage)]
