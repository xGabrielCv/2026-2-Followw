"""Hash da senha administrativa, independente da configuração e do banco."""

import base64
import hashlib
import hmac
import os

# scrypt: ~64 MB e dezenas de ms por tentativa, caro para quem testa senhas em massa.
_N, _R, _P = 2**15, 8, 1
_MAXMEM = 128 * 1024 * 1024
MIN_PASSWORD = 12


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(
        password.encode(), salt=salt, n=_N, r=_R, p=_P, maxmem=_MAXMEM, dklen=32
    )
    encode = base64.b64encode
    return f"scrypt${_N}${_R}${_P}${encode(salt).decode()}${encode(digest).decode()}"


def verify_password(password: str, stored: str) -> bool:
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
