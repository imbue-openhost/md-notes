"""WebSocket endpoint for Yjs document sync via pycrdt."""

import asyncio
import logging
from pathlib import Path

from quart import Blueprint, websocket

from pycrdt import Doc, Text
from pycrdt.websocket import WebsocketServer, YRoom

from ..config import VAULT_PATH
from ..vault import read_file, write_file, PathTraversalError

log = logging.getLogger(__name__)

bp = Blueprint("sync", __name__)

# Global WebSocket server — started/stopped with the Quart app lifecycle.
_ws_server: WebsocketServer | None = None

# Track which rooms have been initialised from disk.
_initialised_rooms: set[str] = set()

# Debounce save timers per room.
_save_tasks: dict[str, asyncio.Task] = {}

SAVE_DEBOUNCE_SECS = 5.0


# ── Channel adapter ──────────────────────────────────────────────────────

class QuartWebsocketChannel:
    """Adapt Quart's websocket object to pycrdt's Channel protocol."""

    def __init__(self, ws, path: str):
        self._ws = ws
        self._path = path

    @property
    def path(self) -> str:
        return self._path

    def __aiter__(self):
        return self

    async def __anext__(self) -> bytes:
        try:
            data = await self._ws.receive()
            if isinstance(data, str):
                return data.encode()
            return data
        except Exception:
            raise StopAsyncIteration

    async def send(self, message: bytes) -> None:
        await self._ws.send(message)

    async def recv(self) -> bytes:
        data = await self._ws.receive()
        if isinstance(data, str):
            return data.encode()
        return data


# ── Room lifecycle ────────────────────────────────────────────────────────

def _doc_path_from_room(room_name: str) -> str:
    """Convert room name back to a file path."""
    return room_name


def _init_room_doc(room: YRoom, room_name: str) -> None:
    """Load .md content from disk into the Y.Doc's shared text."""
    if room_name in _initialised_rooms:
        return

    file_path = _doc_path_from_room(room_name)
    try:
        content = read_file(VAULT_PATH, file_path)
    except (FileNotFoundError, PathTraversalError):
        content = ""

    doc = room.ydoc
    doc["content"] = text = Text()
    if content:
        text += content

    _initialised_rooms.add(room_name)
    log.info("Initialised room %s from disk (%d chars)", room_name, len(content))


async def _save_room(room_name: str, room: YRoom) -> None:
    """Write Y.Doc text content back to the .md file."""
    try:
        doc = room.ydoc
        text = doc.get("content")
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

    async def _delayed_save():
        await asyncio.sleep(SAVE_DEBOUNCE_SECS)
        await _save_room(room_name, room)

    _save_tasks[room_name] = asyncio.ensure_future(_delayed_save())


# ── Server lifecycle ──────────────────────────────────────────────────────

_ws_server_task: asyncio.Task | None = None


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
            pass
    await _ws_server.stop()
    if _ws_server_task:
        _ws_server_task.cancel()
        _ws_server_task = None
    _ws_server = None
    _initialised_rooms.clear()
    log.info("Yjs WebSocket server stopped")


# ── WebSocket route ───────────────────────────────────────────────────────

@bp.websocket("/ws/sync/<path:filepath>")
async def sync_doc(filepath: str):
    """Yjs sync endpoint for a single document."""
    if _ws_server is None:
        await websocket.close(1011, "Sync server not running")
        return

    room_name = filepath
    room = await _ws_server.get_room(room_name)
    _init_room_doc(room, room_name)
    room.ready = True

    channel = QuartWebsocketChannel(websocket._get_current_object(), room_name)

    try:
        await _ws_server.serve(channel)
    finally:
        # When last client disconnects, save to disk
        if not room.clients:
            await _save_room(room_name, room)
            await _ws_server.delete_room(room=room)
            _initialised_rooms.discard(room_name)
