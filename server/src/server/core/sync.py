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
import uuid
from pathlib import Path
from typing import Any
from typing import ClassVar
from typing import Self

from loguru import logger
from pycrdt import Map
from pycrdt import Text
from pycrdt.websocket import WebsocketServer
from pycrdt.websocket import YRoom

from server.core.files import PathTraversalError
from server.core.files import read_file
from server.core.files import write_file


class SyncNotRunning(Exception):
    """Raised by ``SyncManager.serve`` when the underlying WebSocket server is not started."""


# ── Channel wrappers ────────────────────────────────────────────────────


_MSG_SYNC = 0
_SYNC_UPDATE = 2

# Yjs sync updates above this size are logged at INFO. Most edits are <100 bytes; an update in
# the kilobytes is suspicious — typically a stale client reconciling its full local state with
# the server's, which is the pattern that produces content duplication.
_LARGE_UPDATE_BYTES = 2048


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
                logger.debug("Dropped update from read-only client")
                continue
            return data  # type: ignore[no-any-return]

    async def send(self, message: bytes) -> None:
        await self._inner.send(message)

    async def recv(self) -> bytes:
        return await self._inner.recv()  # type: ignore[no-any-return]


class LoggingChannel:
    """Wraps a channel to log suspiciously-large incoming Yjs sync updates at INFO."""

    def __init__(self, inner: Any, client_id: str):
        self._inner = inner
        self._client_id = client_id

    @property
    def path(self) -> str:
        return self._inner.path  # type: ignore[no-any-return]

    def __aiter__(self) -> Self:
        return self

    async def __anext__(self) -> bytes:
        data: bytes = await self._inner.__anext__()
        if len(data) >= 2 and data[0] == _MSG_SYNC and data[1] == _SYNC_UPDATE and len(data) >= _LARGE_UPDATE_BYTES:
            logger.info(
                "Large sync update from client {} on {}: {} bytes (possible stale-state merge)",
                self._client_id,
                self._inner.path,
                len(data),
            )
        return data

    async def send(self, message: bytes) -> None:
        await self._inner.send(message)

    async def recv(self) -> bytes:
        return await self._inner.recv()  # type: ignore[no-any-return]


# ── Sync manager ────────────────────────────────────────────────────────


class SyncManager:
    """Owns the pycrdt WebSocket server and the lifecycle of every active room."""

    SAVE_DEBOUNCE_SECS: ClassVar[float] = 5.0
    SAVE_MAX_INTERVAL_SECS: ClassVar[float] = 30.0
    ROOM_CLEANUP_DELAY_SECS: ClassVar[float] = 300.0

    def __init__(self, vault_path: Path) -> None:
        self._vault_path = vault_path
        self._ws_server: WebsocketServer | None = None
        self._ws_server_task: asyncio.Task[None] | None = None
        self._initialised_rooms: set[str] = set()
        self._save_tasks: dict[str, asyncio.Task[None]] = {}
        self._first_dirty_at: dict[str, float] = {}
        self._cleanup_tasks: dict[str, asyncio.Task[None]] = {}
        self._last_saved_size: dict[str, int] = {}

    # ── lifecycle ───────────────────────────────────────────────────────

    async def start(self) -> None:
        self._ws_server = WebsocketServer(rooms_ready=False, auto_clean_rooms=False)
        self._ws_server_task = asyncio.ensure_future(self._ws_server.start())
        await asyncio.sleep(0.1)
        logger.info("Yjs WebSocket server started")

    async def stop(self) -> None:
        if self._ws_server is None:
            return
        for task in self._cleanup_tasks.values():
            task.cancel()
        self._cleanup_tasks.clear()
        for room_name in list(self._initialised_rooms):
            try:
                room = await self._ws_server.get_room(room_name)
                await self._save_room(room_name, room)
            except Exception:
                logger.exception("Failed to save room {} during shutdown", room_name)
        await self._ws_server.stop()
        if self._ws_server_task:
            self._ws_server_task.cancel()
            self._ws_server_task = None
        self._ws_server = None
        self._initialised_rooms.clear()
        self._first_dirty_at.clear()
        logger.info("Yjs WebSocket server stopped")

    # ── public serve ────────────────────────────────────────────────────

    async def serve(self, channel: Any) -> None:
        """Serve a Yjs sync session on ``channel``.

        ``channel`` must conform to pycrdt's Channel protocol: a ``path`` property, async iteration yielding
        bytes, and ``send``/``recv`` of bytes. Raises ``SyncNotRunning`` if the server is not started.
        """
        if self._ws_server is None:
            raise SyncNotRunning()

        doc_path = channel.path
        client_id = uuid.uuid4().hex[:8]

        pending = self._cleanup_tasks.pop(doc_path, None)
        if pending and not pending.done():
            pending.cancel()
            logger.info("Cancelled pending cleanup for {} — new client joining", doc_path)

        room = await self._ws_server.get_room(doc_path)
        self._init_room(room, doc_path)
        room.ready = True

        # Wrap original channel (which may already be ReadOnlyChannel) so we get visibility into
        # large incoming updates. The wrapper preserves .path for downstream room routing.
        if not isinstance(channel, LoggingChannel):
            channel = LoggingChannel(channel, client_id)

        logger.info(
            "Client {} joined {} (now {} client(s))",
            client_id,
            doc_path,
            len(room.clients) + 1,
        )

        try:
            await self._ws_server.serve(channel)
        finally:
            remaining = len(room.clients)
            logger.info(
                "Client {} left {} ({} client(s) remain)",
                client_id,
                doc_path,
                remaining,
            )
            if not room.clients:
                self._schedule_room_cleanup(doc_path, room)

    # ── room cleanup ─────────────────────────────────────────────────────

    def _schedule_room_cleanup(self, doc_path: str, room: YRoom) -> None:
        """Schedule room deletion after a grace period instead of deleting immediately.

        Without this delay, a brief WebSocket disconnect (common on mobile, tab-switch, or network blip) causes
        the server to destroy the room and discard the Y.Doc. When the client reconnects, the server creates a
        fresh Y.Doc from disk with new internal client IDs. The reconnecting client's still-alive Y.Doc then
        syncs with this fresh doc — Yjs treats the two sets of operations as independent insertions at the same
        position, doubling every piece of content.

        The grace period keeps the room (and its Y.Doc) alive long enough for the client to reconnect to the
        *same* Y.Doc, avoiding the duplication entirely. ``serve()`` cancels a pending cleanup if a new client
        joins during the window.
        """
        existing = self._cleanup_tasks.get(doc_path)
        if existing and not existing.done():
            existing.cancel()

        logger.info(
            "Room {} idle (0 clients); cleanup scheduled in {}s",
            doc_path,
            self.ROOM_CLEANUP_DELAY_SECS,
        )

        async def _delayed_cleanup() -> None:
            await asyncio.sleep(self.ROOM_CLEANUP_DELAY_SECS)
            if self._ws_server and not room.clients:
                await self._save_room(doc_path, room)
                await self._ws_server.delete_room(room=room)
                self._initialised_rooms.discard(doc_path)
                self._last_saved_size.pop(doc_path, None)
                logger.info("Closed room {} after grace period", doc_path)
            self._cleanup_tasks.pop(doc_path, None)

        self._cleanup_tasks[doc_path] = asyncio.ensure_future(_delayed_cleanup())

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

        # Random ID so clients can detect when the server recreated the room (see sync.ts).
        meta: Map[str] = Map()
        doc["meta"] = meta
        meta["room_epoch"] = uuid.uuid4().hex

        def on_change(event: Any) -> None:
            self._schedule_save(room_name, room)

        doc.observe(on_change)

        self._initialised_rooms.add(room_name)
        self._last_saved_size[room_name] = len(content)
        logger.info("Opened room {} from disk ({} chars)", room_name, len(content))

    async def _save_room(self, room_name: str, room: YRoom) -> None:
        """Write Y.Doc text content back to the .md file."""
        try:
            doc = room.ydoc
            text = doc.get("content", type=Text)
            if text is None:
                return
            content = str(text)
            new_size = len(content)
            prev_size = self._last_saved_size.get(room_name)
            write_file(self._vault_path, room_name, content)
            self._last_saved_size[room_name] = new_size
            self._first_dirty_at.pop(room_name, None)
            # Flag suspicious size jumps (likely duplication). Threshold: grew by >25% AND >500 chars.
            if prev_size is not None and new_size > prev_size * 1.25 and new_size - prev_size > 500:
                logger.info(
                    "Room {} grew from {} to {} chars (+{}, {:.0%}) — possible duplication",
                    room_name,
                    prev_size,
                    new_size,
                    new_size - prev_size,
                    (new_size - prev_size) / max(prev_size, 1),
                )
            else:
                logger.debug("Saved room {} to disk ({} chars)", room_name, new_size)
        except Exception:
            logger.exception("Failed to save room {}", room_name)

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
