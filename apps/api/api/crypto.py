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

from api.cookies import _hkdf
from api.core.config import settings

_NONCE = 12
_FILE_HEADER = b"FWENC2\x00"


def _secret(key_id: str | None) -> str:
    if key_id is None and "legacy" in settings.data_encryption_previous_keys:
        return settings.data_encryption_previous_keys["legacy"]
    if key_id is None or key_id == settings.data_encryption_key_id:
        return settings.data_encryption_key or settings.jwt_secret_key
    if key_id in settings.data_encryption_previous_keys:
        return settings.data_encryption_previous_keys[key_id]
    raise ValueError("Versão da chave indisponível; restaure o chaveiro da instalação")


@cache
def _cipher(secret: str) -> AESGCM:
    return AESGCM(_hkdf(secret, "followw:data-at-rest"))


def _aad(context: str, key_id: str | None) -> bytes:
    return context.encode() if key_id is None else f"v2:{key_id}:{context}".encode()


def _seal(data: bytes, context: str, key_id: str) -> bytes:
    nonce = os.urandom(_NONCE)
    return nonce + _cipher(_secret(key_id)).encrypt(nonce, data, _aad(context, key_id))


def _open(data: bytes, context: str, key_id: str | None) -> bytes:
    if len(data) < _NONCE + 16:
        raise ValueError("Conteúdo cifrado incompleto")
    try:
        return _cipher(_secret(key_id)).decrypt(
            data[:_NONCE], data[_NONCE:], _aad(context, key_id)
        )
    except InvalidTag as error:
        raise ValueError("Conteúdo adulterado, chave ou contexto errado") from error


def encrypt(value: str, context: str) -> str:
    key_id = settings.data_encryption_key_id
    return (
        f"v2:{key_id}:"
        + base64.urlsafe_b64encode(_seal(value.encode(), context, key_id)).decode()
    )


def decrypt(value: str, context: str) -> str:
    if value.startswith("v1:"):
        key_id, encoded = None, value[3:]
    elif value.startswith("v2:"):
        try:
            _, key_id, encoded = value.split(":", 2)
        except ValueError:
            raise ValueError("Formato cifrado inválido") from None
    else:
        raise ValueError("Valor sem cifra")
    raw = base64.b64decode(encoded, altchars=b"-_", validate=True)
    return _open(raw, context, key_id).decode()


def encrypt_bytes(data: bytes, context: str) -> bytes:
    key_id = settings.data_encryption_key_id
    label = key_id.encode("ascii")
    return _FILE_HEADER + bytes([len(label)]) + label + _seal(data, context, key_id)


def decrypt_bytes(data: bytes, context: str) -> bytes:
    if not data.startswith(_FILE_HEADER):
        return _open(data, context, None)
    offset = len(_FILE_HEADER)
    if len(data) <= offset or not 1 <= data[offset] <= 32:
        raise ValueError("Formato do arquivo inválido")
    size = data[offset]
    key_id = data[offset + 1 : offset + 1 + size].decode("ascii")
    return _open(data[offset + 1 + size :], context, key_id)


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
