"""Defesas de toda requisição: cabeçalhos de segurança, origem das escritas e tamanho do corpo."""

from urllib.parse import urlsplit

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from api.core.config import settings

_UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}
# Material: 20 MB de arquivo mais o envelope do multipart. O resto é JSON pequeno.
_MAX_UPLOAD = 21 * 1024 * 1024
_MAX_BODY = 256 * 1024
_HEADERS = {
    b"x-content-type-options": b"nosniff",
    b"referrer-policy": b"no-referrer",
    b"x-frame-options": b"DENY",
    b"cross-origin-resource-policy": b"same-site",
    b"permissions-policy": b"camera=(), microphone=(), geolocation=(), payment=()",
}
_HSTS = (b"strict-transport-security", b"max-age=31536000; includeSubDomains")


def _allowed_origin(origin: str, host: str | None) -> bool:
    if origin in settings.cors_origins:
        return True
    parsed = urlsplit(origin)
    if host and parsed.netloc == host:
        return True
    # Em desenvolvimento, o front no localhost chama a API por proxy.
    return settings.environment != "production" and parsed.hostname in (
        "localhost",
        "127.0.0.1",
    )


class SecurityMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope["headers"])
        method = scope["method"]
        if method in _UNSAFE:
            # Contra CSRF além do SameSite: escrita só vem do próprio app.
            origin = headers.get(b"origin", b"").decode("latin-1")
            host = headers.get(b"host", b"").decode("latin-1") or None
            if origin and origin != "null" and not _allowed_origin(origin, host):
                await JSONResponse({"detail": "Origem recusada."}, 403)(
                    scope, receive, send
                )
                return
            if origin == "null":
                await JSONResponse({"detail": "Origem recusada."}, 403)(
                    scope, receive, send
                )
                return
            length = headers.get(b"content-length")
            content_type = headers.get(b"content-type", b"")
            limit = _MAX_UPLOAD if content_type.startswith(b"multipart/") else _MAX_BODY
            if length is not None and (not length.isdigit() or int(length) > limit):
                await JSONResponse({"detail": "Corpo grande demais."}, 413)(
                    scope, receive, send
                )
                return
            if length is None and headers.get(b"transfer-encoding"):
                receive = _capped(receive, limit)

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                present = {key.lower() for key, _ in message.get("headers", [])}
                extra = [(k, v) for k, v in _HEADERS.items() if k not in present]
                if settings.environment == "production":
                    extra.append(_HSTS)
                message["headers"] = [*message.get("headers", []), *extra]
            await send(message)

        await self.app(scope, receive, send_with_headers)


class BodyTooLarge(Exception):
    pass


def _capped(receive: Receive, limit: int) -> Receive:
    """Corpo sem tamanho declarado (chunked): corta ao passar do limite."""
    total = 0

    async def wrapped() -> Message:
        nonlocal total
        message = await receive()
        if message["type"] == "http.request":
            total += len(message.get("body", b""))
            if total > limit:
                raise BodyTooLarge
        return message

    return wrapped
