"""Cifra em repouso do conteúdo da comunidade (AES-256-GCM).

Quem lê o banco (um backup, um dump, um acesso indevido) vê só `v1:...`: o texto só volta dentro
da API, com a chave do `DATA_ENCRYPTION_KEY`. Cada coluna usa o próprio contexto como dado
autenticado, então um valor copiado para outra coluna não decifra.
"""

import base64
import os
from functools import cache

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sigaa_client import lookup_key
from sqlalchemy import Text
from sqlalchemy.engine import Dialect
from sqlalchemy.types import TypeDecorator

from api.cookies import _hkdf, derive_key
from api.core.config import settings

_PREFIX = "v1:"
_NONCE = 12


@cache
def _cipher() -> AESGCM:
    if settings.data_encryption_key:
        key = _hkdf(settings.data_encryption_key, "followw:data-at-rest")
    else:
        # Sem chave própria, deriva do segredo dos cookies (bom para dev; em produção, separe).
        key = derive_key("followw:data-at-rest")
    return AESGCM(key)


def encrypt(value: str, context: str) -> str:
    nonce = os.urandom(_NONCE)
    sealed = _cipher().encrypt(nonce, value.encode(), context.encode())
    return _PREFIX + base64.urlsafe_b64encode(nonce + sealed).decode()


def decrypt(value: str, context: str) -> str:
    if not value.startswith(_PREFIX):
        raise ValueError("Valor sem cifra")
    raw = base64.urlsafe_b64decode(value.removeprefix(_PREFIX))
    try:
        return _cipher().decrypt(raw[:_NONCE], raw[_NONCE:], context.encode()).decode()
    except InvalidTag as error:
        raise ValueError("Chave ou contexto errado") from error


def encrypt_bytes(data: bytes, context: str) -> bytes:
    nonce = os.urandom(_NONCE)
    return nonce + _cipher().encrypt(nonce, data, context.encode())


def decrypt_bytes(data: bytes, context: str) -> bytes:
    try:
        return _cipher().decrypt(data[:_NONCE], data[_NONCE:], context.encode())
    except InvalidTag as error:
        raise ValueError("Arquivo adulterado ou chave errada") from error


class Encrypted(TypeDecorator[str]):
    """Texto cifrado na gravação e decifrado na leitura; o SQL nunca vê o conteúdo."""

    impl = Text
    cache_ok = True

    def __init__(self, context: str) -> None:
        super().__init__()
        self.context = context

    def process_bind_param(self, value: str | None, dialect: Dialect) -> str | None:
        return None if value is None else encrypt(value, self.context)

    def process_result_value(self, value: str | None, dialect: Dialect) -> str | None:
        return None if value is None else decrypt(value, self.context)


def matches(q: str, *texts: str | None) -> bool:
    """Cada termo de `q`, sem acento nem caixa, aparece em algum dos textos (busca já decifrada)."""
    haystack = " ".join(lookup_key(text) for text in texts if text)
    return all(term in haystack for term in lookup_key(q).split())
