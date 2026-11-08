"""Chaves anônimas: o mesmo aparelho gera a mesma chave num escopo, sem nenhuma ligação com o aluno.

A origem é um segredo aleatório que o navegador cria e guarda (`X-Followw-Author`), nunca a
matrícula: nem quem administra o servidor, sabendo a matrícula de alguém, consegue conferir se
ela escreveu algo. O HMAC com um segredo do servidor e o escopo (uma matéria, uma conversa, uma
turma) faz duas chaves de escopos diferentes nunca se ligarem entre si.
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
