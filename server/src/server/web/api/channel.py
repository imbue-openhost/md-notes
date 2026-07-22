"""Litestar WebSocket → pycrdt Channel adapter."""

import asyncio
from typing import Any
from typing import Self

from litestar import WebSocket
from litestar.exceptions import WebSocketDisconnect
from loguru import logger


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
            data = await self._ws.receive_bytes()
        except WebSocketDisconnect as e:
            logger.info(
                "[ch] {} recv: WebSocketDisconnect code={} reason={!r}",
                self._path,
                getattr(e, "code", None),
                getattr(e, "reason", None),
            )
            raise StopAsyncIteration from None
        except (asyncio.CancelledError, GeneratorExit) as e:
            logger.info("[ch] {} recv: {}", self._path, type(e).__name__)
            raise StopAsyncIteration from None
        except Exception as e:
            logger.opt(exception=True).warning(
                "[ch] {} recv: {}: {}",
                self._path,
                type(e).__name__,
                e,
            )
            raise StopAsyncIteration from None
        logger.debug("[ch] {} recv ok ({} bytes)", self._path, len(data))
        return data

    async def close(self, code: int, reason: str) -> None:
        try:
            await self._ws.close(code=code, reason=reason)
        except Exception as e:
            logger.debug("[ch] {} close failed: {}: {}", self._path, type(e).__name__, e)

    async def send(self, message: bytes) -> None:
        try:
            await self._ws.send_bytes(message)
        except Exception as e:
            logger.warning(
                "[ch] {} send ({} bytes) failed: {}: {}",
                self._path,
                len(message),
                type(e).__name__,
                e,
            )
            raise ConnectionError(f"WebSocket closed: {e}") from e
        logger.debug("[ch] {} send ok ({} bytes)", self._path, len(message))

    async def recv(self) -> bytes:
        return await self._ws.receive_bytes()
