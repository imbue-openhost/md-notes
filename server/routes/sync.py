"""WebSocket endpoint for Yjs document sync via pycrdt."""

import asyncio
import logging
from typing import Any
from typing import Self

from pycrdt import Text
from pycrdt.websocket import WebsocketServer
from pycrdt.websocket import YRoom
from quart import Blueprint
from quart import websocket
from quart.wrappers import Websocket

from server.config import VAULT_PATH
from server.vault import PathTraversalError
from server.vault import read_file
from server.vault import write_file

log = logging.getLogger(__name__)

bp = Blueprint("sync", __name__)

# Global WebSocket server — started/stopped with the Quart app lifecycle.
_ws_server: WebsocketServer | None = None

# Track which rooms have been initialised from disk.
_initialised_rooms: set[str] = set()

# Debounce save timers per room.
_save_tasks: dict[str, asyncio.Task[None]] = {}

SAVE_DEBOUNCE_SECS = 5.0


# ── Channel adapter ──────────────────────────────────────────────────────


class QuartWebsocketChannel:
    """Adapt Quart's websocket object to pycrdt's Channel protocol."""

    def __init__(self, ws: Websocket, path: str):
        self._ws = ws
        self._path = path

    @property
    def path(self) -> str:
        return self._path

    def __aiter__(self) -> Self:
        return self

    async def __anext__(self) -> bytes:
        try:
            data = await self._ws.receive()
            if isinstance(data, str):
                return data.encode()
            assert isinstance(data, bytes)
            return data
        except (asyncio.CancelledError, GeneratorExit):
            raise StopAsyncIteration from None
        except Exception:
            log.debug("WebSocket receive error on %s", self._path, exc_info=True)
            raise StopAsyncIteration from None

    async def send(self, message: bytes) -> None:
        try:
            await self._ws.send(message)
        except Exception as e:
            log.debug("WebSocket send error on %s: %s", self._path, e)
            raise ConnectionError(f"WebSocket closed: {e}") from e

    async def recv(self) -> bytes:
        data = await self._ws.receive()
        if isinstance(data, str):
            return data.encode()
        assert isinstance(data, bytes)
        return data


# ── Room lifecycle ────────────────────────────────────────────────────────


def _doc_path_from_room(room_name: str) -> str:
    """Convert room name back to a file path."""
    return room_name


def _init_room_doc(room: YRoom, room_name: str) -> None:
    """Load .md content from disk into the Y.Doc's shared text."""
    if room_name in _initialised_rooms:
        return

    # Ensure the vault directory exists on first sync. Room paths are <vault_name>/<rel_path>.
    if "/" in room_name:
        vault_name = room_name.split("/", 1)[0]
        (VAULT_PATH / vault_name).mkdir(parents=True, exist_ok=True)

    file_path = _doc_path_from_room(room_name)
    try:
        content = read_file(VAULT_PATH, file_path)
    except (FileNotFoundError, PathTraversalError):
        content = ""

    doc = room.ydoc
    doc["content"] = text = Text()
    if content:
        text += content

    # Subscribe to document changes for debounced auto-save
    def on_change(event: Any) -> None:
        _schedule_save(room_name, room)

    doc.observe(on_change)

    _initialised_rooms.add(room_name)
    log.info("Initialised room %s from disk (%d chars)", room_name, len(content))


async def _save_room(room_name: str, room: YRoom) -> None:
    """Write Y.Doc text content back to the .md file."""
    try:
        doc = room.ydoc
        text = doc.get("content", type=Text)
        if text is None:
            return
        content = str(text)
        file_path = _doc_path_from_room(room_name)
        write_file(VAULT_PATH, file_path, content)
        log.info("Saved room %s to disk (%d chars)", room_name, len(content))
    except Exception:
        log.exception("Failed to save room %s", room_name)


def _schedule_save(room_name: str, room: YRoom) -> None:
    """Debounced save — waits SAVE_DEBOUNCE_SECS after the last call."""
    existing = _save_tasks.get(room_name)
    if existing and not existing.done():
        existing.cancel()

    async def _delayed_save() -> None:
        await asyncio.sleep(SAVE_DEBOUNCE_SECS)
        await _save_room(room_name, room)

    _save_tasks[room_name] = asyncio.ensure_future(_delayed_save())


# ── Server lifecycle ──────────────────────────────────────────────────────

_ws_server_task: asyncio.Task[None] | None = None


async def start_ws_server() -> None:
    global _ws_server, _ws_server_task
    _ws_server = WebsocketServer(rooms_ready=False, auto_clean_rooms=False)
    # start() runs indefinitely, so launch it as a background task
    _ws_server_task = asyncio.ensure_future(_ws_server.start())
    # Give the server a moment to initialise
    await asyncio.sleep(0.1)
    log.info("Yjs WebSocket server started")


async def stop_ws_server() -> None:
    global _ws_server, _ws_server_task
    if _ws_server is None:
        return
    # Save all open rooms before stopping
    for room_name in list(_initialised_rooms):
        try:
            room = await _ws_server.get_room(room_name)
            await _save_room(room_name, room)
        except Exception:
            log.exception("Failed to save room %s during shutdown", room_name)
    await _ws_server.stop()
    if _ws_server_task:
        _ws_server_task.cancel()
        _ws_server_task = None
    _ws_server = None
    _initialised_rooms.clear()
    log.info("Yjs WebSocket server stopped")


# ── Public API (used by share.py) ─────────────────────────────────────────


def get_ws_server() -> WebsocketServer | None:
    """Return the global WebSocket server instance."""
    return _ws_server


async def serve_document(ws_server: WebsocketServer, ws: Websocket, doc_path: str) -> None:
    """Set up a room for doc_path and serve the given websocket connection."""
    room = await ws_server.get_room(doc_path)
    _init_room_doc(room, doc_path)
    room.ready = True

    channel = QuartWebsocketChannel(ws, doc_path)

    try:
        await ws_server.serve(channel)
    finally:
        if not room.clients:
            await _save_room(doc_path, room)
            await ws_server.delete_room(room=room)
            _initialised_rooms.discard(doc_path)


# ── WebSocket route ───────────────────────────────────────────────────────


@bp.websocket("/ws/sync/<path:filepath>")
async def sync_doc(filepath: str) -> None:
    """Yjs sync endpoint for a single document."""
    if _ws_server is None:
        await websocket.close(1011, "Sync server not running")
        return

    await serve_document(_ws_server, websocket._get_current_object(), filepath)  # type: ignore[attr-defined]
