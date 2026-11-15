"""Canal de eventos do CloudBeaver com autorização administrativa contínua."""

import asyncio
from contextlib import suppress

from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed, WebSocketException

from api.core.config import settings
from api.db.main import DatabaseDep
from api.modules.admin import auth
from api.modules.admin.database_gateway import PREFIX

router = APIRouter()
SOCKET_URL = f"ws://127.0.0.1:8978{PREFIX}api/ws"


async def authorize_socket(socket: WebSocket, db):
    scope = {**socket.scope, "type": "http", "method": "GET"}
    scope["scheme"] = "https" if socket.url.scheme == "wss" else "http"
    request = Request(scope)
    auth.authorize(await auth.require_admin(request, db), "owner")
    origin = socket.headers.get("origin")
    expected = f"{scope['scheme']}://{socket.headers.get('host')}"
    if not origin or origin not in {*settings.cors_origins, expected}:
        raise HTTPException(403, "Origem recusada.")
    if not settings.cloudbeaver_enabled:
        raise HTTPException(503, "CloudBeaver desabilitado.")


@router.websocket("/api/ws")
async def events(socket: WebSocket, db: DatabaseDep):
    try:
        await authorize_socket(socket, db)
    except HTTPException:
        await socket.close(code=1008)
        return
    headers = {}
    if cookie := socket.cookies.get("cb-session-id"):
        headers["Cookie"] = f"cb-session-id={cookie}"
        headers["Authorization"] = f"Bearer {cookie}"
    tasks = []
    try:
        async with connect(
            SOCKET_URL,
            additional_headers=headers,
            origin=socket.headers.get("origin"),
            proxy=None,
            open_timeout=5,
            close_timeout=3,
            compression=None,
        ) as upstream:
            await socket.accept()

            async def from_browser():
                while True:
                    message = await socket.receive()
                    if message["type"] == "websocket.disconnect":
                        return
                    await authorize_socket(socket, db)
                    await upstream.send(
                        message.get("text")
                        if message.get("text") is not None
                        else message["bytes"]
                    )

            async def from_server():
                async for message in upstream:
                    if isinstance(message, str):
                        await socket.send_text(message)
                    else:
                        await socket.send_bytes(message)

            async def guard():
                while True:
                    await asyncio.sleep(15)
                    await authorize_socket(socket, db)

            tasks = [
                asyncio.create_task(run()) for run in (from_browser, from_server, guard)
            ]
            finished, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in finished:
                task.result()
    except HTTPException:
        with suppress(RuntimeError, WebSocketDisconnect):
            await socket.close(code=1008)
    except OSError, TimeoutError, WebSocketException, WebSocketDisconnect:
        with suppress(RuntimeError, WebSocketDisconnect):
            await socket.close(code=1011)
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        with suppress(RuntimeError, ConnectionClosed, WebSocketDisconnect):
            await socket.close()
