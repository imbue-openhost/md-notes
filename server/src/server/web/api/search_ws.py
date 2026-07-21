"""Interactive search over a websocket."""

import threading
from functools import partial
from pathlib import Path
from typing import Any

import anyio
import attr
from litestar import WebSocket
from litestar.exceptions import WebSocketDisconnect
from loguru import logger

from server.core.search import SearchCancelled
from server.core.search import search_vault


async def serve_search_socket(socket: WebSocket[Any, Any, Any], root: Path) -> None:
    """Interactive search session: one socket per palette, one query message per keystroke.

    Client sends {"id", "q", "normalize", "limit"}; server replies {"id", "hits"}. Each incoming
    query cancels the running scan at its next file/chunk boundary and starts a new one, so only
    the latest query does full work — this latest-wins coalescing replaces client-side debouncing.
    Superseded scans send no reply.
    """
    current_cancel: threading.Event | None = None

    def cancel_current() -> None:
        if current_cancel is not None:
            current_cancel.set()

    async def run_scan(query_id: int, q: str, limit: int, normalize: bool, cancel: threading.Event) -> None:
        try:
            hits = await anyio.to_thread.run_sync(partial(search_vault, root, q, limit, normalize, cancel))
            await socket.send_json({"id": query_id, "hits": [attr.asdict(hit) for hit in hits]})
        except SearchCancelled:
            logger.debug("search superseded (q={!r})", q)

    try:
        # The task group joins running scans on exit; cancel_current() first so that's near-instant.
        async with anyio.create_task_group() as task_group:
            while True:
                try:
                    message = await socket.receive_json()
                except WebSocketDisconnect:
                    cancel_current()
                    return
                if (
                    not isinstance(message, dict)
                    or not isinstance(message.get("id"), int)
                    or not isinstance(message.get("q"), str)
                ):
                    cancel_current()
                    await socket.close(code=1003, reason="Malformed search request")
                    return
                cancel_current()
                current_cancel = threading.Event()
                task_group.start_soon(
                    run_scan,
                    message["id"],
                    message["q"],
                    int(message.get("limit", 50)),
                    bool(message.get("normalize", True)),
                    current_cancel,
                )
    finally:
        cancel_current()
