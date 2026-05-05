"""WebSocket route for Yjs document sync.

Wraps Litestar's ``WebSocket`` in a Channel-protocol adapter and hands it to ``SyncManager``. All sync logic
lives in ``server.core.sync``.
"""

import asyncio
import logging
from typing import Any
from typing import Self

from litestar import WebSocket
from litestar import websocket
from litestar.exceptions import WebSocketDisconnect

from server.core.sync import SyncManager
from server.core.sync import SyncNotRunning

log = logging.getLogger(__name__)


class LitestarWebsocketChannel:
    """Adapt Litestar's WebSocket to pycrdt's Channel protocol."""

    def __init__(self, ws: WebSocket[Any, Any, Any], path: str):
        self._ws = ws
        self._path = path

    @property
    def path(self) -> str:
        return self._path

    def __aiter__(self) -> Self:
        return self

    async def __anext__(self) -> bytes:
        try:
            return await self._ws.receive_bytes()
        except WebSocketDisconnect:
            raise StopAsyncIteration from None
        except (asyncio.CancelledError, GeneratorExit):
            raise StopAsyncIteration from None
        except Exception:
            log.debug("WebSocket receive error on %s", self._path, exc_info=True)
            raise StopAsyncIteration from None

    async def send(self, message: bytes) -> None:
        try:
            await self._ws.send_bytes(message)
        except Exception as e:
            log.debug("WebSocket send error on %s: %s", self._path, e)
            raise ConnectionError(f"WebSocket closed: {e}") from e

    async def recv(self) -> bytes:
        return await self._ws.receive_bytes()


@websocket("/ws/sync/{filepath:path}")
async def sync_doc(socket: WebSocket[Any, Any, Any], filepath: str) -> None:
    """Yjs sync endpoint for a single document."""
    await socket.accept()
    manager: SyncManager = socket.app.state.sync_manager
    channel = LitestarWebsocketChannel(socket, filepath.lstrip("/"))
    try:
        await manager.serve(channel)
    except SyncNotRunning:
        await socket.close(code=1011, reason="Sync server not running")
