"""Litestar WebSocket → pycrdt Channel adapter."""

import asyncio
import logging
from typing import Any
from typing import Self

from litestar import WebSocket
from litestar.exceptions import WebSocketDisconnect

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
