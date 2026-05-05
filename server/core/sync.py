"""Yjs document sync: room lifecycle and channel filtering.

Each document is identified by its path within the vault (e.g. ``myvault/notes/foo.md``); the same string keys
both the on-disk file and the in-memory Yjs room. Markdown files on disk are the source of truth; the CRDT is
an ephemeral coordination layer that exists only while clients are connected.

A room's ``Y.Doc`` holds a single ``Y.Text`` named ``content``. Round-tripping is a pure string identity:
``read_file(...)`` seeds the text on first connect, ``str(text)`` writes it back on save.

The full lifecycle for each room — disk read on first connect, debounced saves while editing, save-and-drop on
last disconnect, save-all on shutdown — is owned by ``SyncManager``. One instance per app, constructed in
``create_app`` and stored on ``app.state.sync_manager``; route handlers look it up off the connection and call
``serve(channel)`` with a Channel-protocol object (any object with ``path``, ``__aiter__``, ``send``, ``recv``).

REST file writes bypass this layer entirely — they edit the ``.md`` directly. A REST write to a doc that has a
live room will be overwritten on the room's next save, so callers should only use REST for files without an
active editing session (creation, rename, delete).
"""

import asyncio
import logging
from pathlib import Path
from typing import Any
from typing import ClassVar
from typing import Self

from pycrdt import Text
from pycrdt.websocket import WebsocketServer
from pycrdt.websocket import YRoom

from server.vault import PathTraversalError
from server.vault import read_file
from server.vault import write_file

log = logging.getLogger(__name__)


class SyncNotRunning(Exception):
    """Raised by ``SyncManager.serve`` when the underlying WebSocket server is not started."""


# ── Read-only channel filter ────────────────────────────────────────────


_MSG_SYNC = 0
_SYNC_UPDATE = 2


class ReadOnlyChannel:
    """Wraps a channel to enforce read-only access.

    Allows the initial sync handshake (sync step 1 + step 2) so the client receives the document contents,
    but drops any subsequent Yjs sync updates from the client. Awareness messages pass through.
    """

    def __init__(self, inner: Any):
        self._inner = inner

    @property
    def path(self) -> str:
        return self._inner.path  # type: ignore[no-any-return]

    def __aiter__(self) -> Self:
        return self

    async def __anext__(self) -> bytes:
        while True:
            data = await self._inner.__anext__()
            if len(data) < 2:
                return data  # type: ignore[no-any-return]
            if data[0] == _MSG_SYNC and data[1] == _SYNC_UPDATE:
                log.debug("Dropped update from read-only client")
                continue
            return data  # type: ignore[no-any-return]

    async def send(self, message: bytes) -> None:
        await self._inner.send(message)

    async def recv(self) -> bytes:
        return await self._inner.recv()  # type: ignore[no-any-return]


# ── Sync manager ────────────────────────────────────────────────────────


class SyncManager:
    """Owns the pycrdt WebSocket server and the lifecycle of every active room."""

    SAVE_DEBOUNCE_SECS: ClassVar[float] = 5.0
    SAVE_MAX_INTERVAL_SECS: ClassVar[float] = 30.0

    def __init__(self, vault_path: Path) -> None:
        self._vault_path = vault_path
        self._ws_server: WebsocketServer | None = None
        self._ws_server_task: asyncio.Task[None] | None = None
        self._initialised_rooms: set[str] = set()
        self._save_tasks: dict[str, asyncio.Task[None]] = {}
        self._first_dirty_at: dict[str, float] = {}

    # ── lifecycle ───────────────────────────────────────────────────────

    async def start(self) -> None:
        self._ws_server = WebsocketServer(rooms_ready=False, auto_clean_rooms=False)
        self._ws_server_task = asyncio.ensure_future(self._ws_server.start())
        await asyncio.sleep(0.1)
        log.info("Yjs WebSocket server started")

    async def stop(self) -> None:
        if self._ws_server is None:
            return
        for room_name in list(self._initialised_rooms):
            try:
                room = await self._ws_server.get_room(room_name)
                await self._save_room(room_name, room)
            except Exception:
                log.exception("Failed to save room %s during shutdown", room_name)
        await self._ws_server.stop()
        if self._ws_server_task:
            self._ws_server_task.cancel()
            self._ws_server_task = None
        self._ws_server = None
        self._initialised_rooms.clear()
        self._first_dirty_at.clear()
        log.info("Yjs WebSocket server stopped")

    # ── public serve ────────────────────────────────────────────────────

    async def serve(self, channel: Any) -> None:
        """Serve a Yjs sync session on ``channel``.

        ``channel`` must conform to pycrdt's Channel protocol: a ``path`` property, async iteration yielding
        bytes, and ``send``/``recv`` of bytes. Raises ``SyncNotRunning`` if the server is not started.
        """
        if self._ws_server is None:
            raise SyncNotRunning()

        doc_path = channel.path
        room = await self._ws_server.get_room(doc_path)
        self._init_room(room, doc_path)
        room.ready = True

        try:
            await self._ws_server.serve(channel)
        finally:
            if not room.clients:
                await self._save_room(doc_path, room)
                await self._ws_server.delete_room(room=room)
                self._initialised_rooms.discard(doc_path)

    # ── room init / save ────────────────────────────────────────────────

    def _init_room(self, room: YRoom, room_name: str) -> None:
        """Load .md content from disk into the Y.Doc's shared text on first connect."""
        if room_name in self._initialised_rooms:
            return

        if "/" in room_name:
            vault_name = room_name.split("/", 1)[0]
            (self._vault_path / vault_name).mkdir(parents=True, exist_ok=True)

        try:
            content = read_file(self._vault_path, room_name)
        except (FileNotFoundError, PathTraversalError):
            content = ""

        doc = room.ydoc
        doc["content"] = text = Text()
        if content:
            text += content

        def on_change(event: Any) -> None:
            self._schedule_save(room_name, room)

        doc.observe(on_change)

        self._initialised_rooms.add(room_name)
        log.info("Initialised room %s from disk (%d chars)", room_name, len(content))

    async def _save_room(self, room_name: str, room: YRoom) -> None:
        """Write Y.Doc text content back to the .md file."""
        try:
            doc = room.ydoc
            text = doc.get("content", type=Text)
            if text is None:
                return
            content = str(text)
            write_file(self._vault_path, room_name, content)
            self._first_dirty_at.pop(room_name, None)
            log.info("Saved room %s to disk (%d chars)", room_name, len(content))
        except Exception:
            log.exception("Failed to save room %s", room_name)

    def _schedule_save(self, room_name: str, room: YRoom) -> None:
        # Debounce by SAVE_DEBOUNCE_SECS of quiet, but cap at SAVE_MAX_INTERVAL_SECS since the room first went
        # dirty so a continuously edited doc still gets persisted on a regular cadence.
        now = asyncio.get_event_loop().time()
        first_dirty = self._first_dirty_at.setdefault(room_name, now)

        existing = self._save_tasks.get(room_name)
        if existing and not existing.done():
            existing.cancel()

        elapsed = now - first_dirty
        delay = min(self.SAVE_DEBOUNCE_SECS, max(0.0, self.SAVE_MAX_INTERVAL_SECS - elapsed))

        async def _delayed_save() -> None:
            await asyncio.sleep(delay)
            await self._save_room(room_name, room)

        self._save_tasks[room_name] = asyncio.ensure_future(_delayed_save())
