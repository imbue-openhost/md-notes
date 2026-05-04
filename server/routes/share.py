"""Share link endpoints and shared document WebSocket."""

import json
import logging
from typing import Self

from quart import Blueprint
from quart import jsonify
from quart import request
from quart import websocket
from quart.typing import ResponseReturnValue

from server.config import FRONTEND_DIST
from server.db import create_link
from server.db import delete_link
from server.db import get_link
from server.db import list_links
from server.routes.sync import QuartWebsocketChannel
from server.routes.sync import _init_room_doc
from server.routes.sync import _initialised_rooms
from server.routes.sync import _save_room
from server.routes.sync import get_ws_server
from server.routes.sync import serve_document

log = logging.getLogger(__name__)

bp = Blueprint("share", __name__)


# ── REST API ──────────────────────────────────────────────────────────────


@bp.route("/api/share", methods=["POST"])
async def create_share() -> ResponseReturnValue:
    """Create a share link.

    Body JSON: {"docPath": "path/to/file.md", "permission": "read"|"write"}
    Returns: {"uuid": "..."}
    """
    data = await request.get_json()
    doc_path = data.get("docPath")
    permission = data.get("permission", "read")
    if not doc_path:
        return jsonify(error="docPath is required"), 400
    if permission not in ("read", "write"):
        return jsonify(error="permission must be 'read' or 'write'"), 400

    link_uuid = create_link(doc_path, permission)
    return jsonify(uuid=link_uuid), 201


@bp.route("/api/share/<link_uuid>", methods=["DELETE"])
async def revoke_share(link_uuid: str) -> ResponseReturnValue:
    """Revoke a share link."""
    if delete_link(link_uuid):
        return jsonify(ok=True)
    return jsonify(error="not found"), 404


@bp.route("/api/share", methods=["GET"])
async def list_shares() -> ResponseReturnValue:
    """List share links, optionally filtered by docPath query param."""
    doc_path = request.args.get("docPath")
    links = list_links(doc_path)
    return jsonify(links)


# ── Share page ────────────────────────────────────────────────────────────


@bp.route("/share/<link_uuid>")
async def share_page(link_uuid: str) -> ResponseReturnValue:
    """Serve the frontend for a shared document."""
    link = get_link(link_uuid)
    if not link:
        return "Share link not found or revoked", 404

    index = FRONTEND_DIST / "index.html"
    if not index.exists():
        return "Frontend not built", 404
    html = index.read_text()
    config_data = json.dumps(
        {
            "uuid": link["uuid"],
            "docPath": link["doc_path"],
            "permission": link["permission"],
        }
    )
    config_script = f"<script>window.__SHARE_CONFIG__ = {config_data}</script>"
    html = html.replace("</head>", f"{config_script}</head>")
    return html, 200, {"Content-Type": "text/html; charset=utf-8"}


# ── Shared document WebSocket ─────────────────────────────────────────────

# Yjs sync protocol message types (first byte of the message)
_MSG_SYNC = 0  # sync protocol messages (step1, step2, update)
_SYNC_UPDATE = 2  # third byte: it's an update (as opposed to step1=0, step2=1)


class ReadOnlyChannel:
    """Wraps a channel to enforce read-only access.

    Allows the initial sync handshake (sync step 1 + step 2) so the
    client receives the document contents, but drops any subsequent
    Yjs sync updates from the client. Awareness messages pass through.
    """

    def __init__(self, inner: QuartWebsocketChannel):
        self._inner = inner

    @property
    def path(self) -> str:
        return self._inner.path

    def __aiter__(self) -> Self:
        return self

    async def __anext__(self) -> bytes:
        while True:
            data = await self._inner.__anext__()
            if len(data) < 2:
                return data
            msg_type = data[0]
            if msg_type == _MSG_SYNC:
                sub_type = data[1]
                if sub_type == _SYNC_UPDATE:
                    # Drop sync updates from read-only clients
                    log.debug("Dropped update from read-only client")
                    continue
            # Allow sync step1/step2 and awareness messages
            return data

    async def send(self, message: bytes) -> None:
        await self._inner.send(message)

    async def recv(self) -> bytes:
        return await self._inner.recv()


@bp.websocket("/ws/share/<link_uuid>")
async def share_sync(link_uuid: str) -> None:
    """Yjs sync for shared documents.

    Read-only links: server drops Yjs update messages from the client,
    only allowing the initial sync handshake so they receive the doc.
    Write links: full bidirectional sync.
    """
    link = get_link(link_uuid)
    if not link:
        await websocket.close(4004, "Share link not found")
        return

    ws_server = get_ws_server()
    if ws_server is None:
        await websocket.close(1011, "Sync server not running")
        return

    doc_path = link["doc_path"]
    permission = link["permission"]

    if permission == "read":
        # Read-only: wrap channel to drop updates
        room = await ws_server.get_room(doc_path)
        _init_room_doc(room, doc_path)
        room.ready = True
        raw_channel = QuartWebsocketChannel(websocket._get_current_object(), doc_path)  # type: ignore[attr-defined]
        channel = ReadOnlyChannel(raw_channel)
        try:
            await ws_server.serve(channel)
        finally:
            if not room.clients:
                await _save_room(doc_path, room)
                await ws_server.delete_room(room=room)
                _initialised_rooms.discard(doc_path)
    else:
        await serve_document(ws_server, websocket._get_current_object(), doc_path)  # type: ignore[attr-defined]
