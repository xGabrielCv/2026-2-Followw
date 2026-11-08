"""Login do painel: usuário e senha definidos por quem administra, nunca guardados em texto.

A senha fica só como hash scrypt no `.env` (`ADMIN_PASSWORD_HASH`), gerado por
`uv run admin-password`. O login abre uma sessão num cookie cifrado, `httponly` e `SameSite=Strict`,
que vence em horas; as rotas que mudam algo exigem também o header `X-Admin-Request`, que um site
de fora não consegue mandar.
"""

import base64
import hashlib
import hmac
import os
import secrets
import time
from collections import deque
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import Depends, HTTPException, Request, Response

from api.cookies import decrypt_cookie, encrypt_cookie
from api.core.config import settings
from api.logger import event

ADMIN_COOKIE = "admin_session"
SESSION_HOURS = 8
# scrypt: ~64 MB e dezenas de ms por tentativa, caro para quem testa senhas em massa.
_N, _R, _P = 2**15, 8, 1
_MAXMEM = 128 * 1024 * 1024
MIN_PASSWORD = 12
# Tentativas erradas por IP numa janela; além disso, o login fica bloqueado para o IP.
_MAX_FAILURES = 5
_WINDOW = 15 * 60
_failures: dict[str, deque[float]] = {}


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


def enabled() -> bool:
    return bool(settings.admin_username and settings.admin_password_hash)


_LOCAL = {"127.0.0.1", "::1", "localhost"}


def can_setup(request: Request) -> bool:
    """Primeiro cadastro pela página: só sem senha definida, fora de produção e no próprio PC."""
    return (
        not enabled()
        and settings.environment != "production"
        and _client(request) in _LOCAL
    )


def setup(request: Request, username: str, password: str) -> None:
    """Grava usuário e hash no `.env` e já vale, sem reiniciar."""
    from api.modules.admin.cli import write_credentials

    if not can_setup(request):
        raise HTTPException(403, "Cadastro indisponível.")
    if len(password) < MIN_PASSWORD:
        raise HTTPException(
            422, f"A senha precisa de pelo menos {MIN_PASSWORD} caracteres."
        )
    digest = hash_password(password)
    write_credentials(username, digest)
    settings.admin_username = username
    settings.admin_password_hash = digest


def _client(request: Request) -> str:
    return request.client.host if request.client else "?"


def _blocked(host: str) -> bool:
    now = time.monotonic()
    attempts = _failures.setdefault(host, deque())
    while attempts and now - attempts[0] > _WINDOW:
        attempts.popleft()
    return len(attempts) >= _MAX_FAILURES


def login(request: Request, response: Response, username: str, password: str) -> None:
    if not enabled():
        raise HTTPException(404, "Painel desligado.")
    host = _client(request)
    if _blocked(host):
        event("admin.login_blocked")
        raise HTTPException(429, "Muitas tentativas. Espere 15 minutos.")
    assert settings.admin_username and settings.admin_password_hash
    # Confere a senha mesmo com usuário errado: o tempo não denuncia qual dos dois errou.
    good_password = verify_password(password, settings.admin_password_hash)
    good_user = hmac.compare_digest(username.encode(), settings.admin_username.encode())
    if not (good_user and good_password):
        _failures[host].append(time.monotonic())
        event("admin.login_failed")
        raise HTTPException(401, "Usuário ou senha incorretos.")
    _failures.pop(host, None)
    expires = datetime.now(UTC) + timedelta(hours=SESSION_HOURS)
    token = encrypt_cookie(
        ADMIN_COOKIE,
        {
            "sub": settings.admin_username,
            "sid": secrets.token_hex(16),
            "exp": int(expires.timestamp()),
        },
    )
    response.set_cookie(
        ADMIN_COOKIE,
        token,
        max_age=SESSION_HOURS * 3600,
        httponly=True,
        secure=settings.environment == "production",
        samesite="strict",
    )
    event("admin.login")


def logout(response: Response) -> None:
    response.delete_cookie(ADMIN_COOKIE, samesite="strict")


def require_admin(request: Request) -> str:
    if not enabled():
        raise HTTPException(404, "Painel desligado.")
    token = request.cookies.get(ADMIN_COOKIE)
    claims = decrypt_cookie(ADMIN_COOKIE, token) if token else None
    if not claims or not hmac.compare_digest(
        str(claims.get("sub", "")).encode(), (settings.admin_username or "").encode()
    ):
        raise HTTPException(401, "Faça login no painel.")
    # Contra CSRF: um site de fora não manda header próprio sem passar pelo CORS.
    if request.method not in ("GET", "HEAD") and (
        request.headers.get("X-Admin-Request") != "1"
    ):
        raise HTTPException(403, "Requisição recusada.")
    return str(claims["sub"])


AdminDep = Depends(require_admin)
AdminUser = Annotated[str, AdminDep]
