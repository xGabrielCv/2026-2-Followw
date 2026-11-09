"""Hash da senha administrativa, independente da configuração e do banco."""

import base64
import hashlib
import hmac
import os

from cryptography.exceptions import InvalidKey
from cryptography.hazmat.primitives.kdf.argon2 import Argon2id

# scrypt: ~64 MB e dezenas de ms por tentativa, caro para quem testa senhas em massa.
_N, _R, _P = 2**15, 8, 1
_MAXMEM = 128 * 1024 * 1024
MIN_PASSWORD = 12


def hash_password(password: str) -> str:
    return Argon2id(
        salt=os.urandom(16), length=32, iterations=3, lanes=1, memory_cost=64 * 1024
    ).derive_phc_encoded(password.encode())


def verify_password(password: str, stored: str) -> bool:
    if stored.startswith("$argon2id$"):
        try:
            Argon2id.verify_phc_encoded(password.encode(), stored)
            return True
        except InvalidKey, ValueError:
            return False
    try:
        scheme, n, r, p, salt, digest = stored.split("$")
        if scheme != "scrypt":
            return False
        expected = base64.b64decode(digest)
        given = hashlib.scrypt(
            password.encode(),
            salt=base64.b64decode(salt),
            n=int(n),
            r=int(r),
            p=int(p),
            maxmem=_MAXMEM,
            dklen=len(expected),
        )
    except ValueError:
        return False
    return hmac.compare_digest(given, expected)
