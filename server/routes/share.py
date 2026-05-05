"""Share link endpoints and shared document WebSocket."""

import json
import logging
from typing import Any
from typing import Self

from litestar import Controller
from litestar import MediaType
from litestar import Response
from litestar import WebSocket
from litestar import delete
from litestar import get
from litestar import post
from litestar import websocket
from litestar.exceptions import ClientException
from litestar.exceptions import NotFoundException
from litestar.status_codes import HTTP_201_CREATED

from server.config import FRONTEND_DIST
from server.db import create_link
from server.db import delete_link
from server.db import get_link
from server.db import list_links
from server.models.common import OkResponse
from server.models.share import CreateShareBody
from server.models.share import CreateShareResponse
from server.models.share import ShareLink
from server.routes.sync import LitestarWebsocketChannel
from server.routes.sync import SyncManager

log = logging.getLogger(__name__)


# ── REST API ──────────────────────────────────────────────────────────────


class ShareController(Controller):
    path = "/api/share"

    @post("/", status_code=HTTP_201_CREATED)
    async def create_share(self, data: CreateShareBody) -> CreateShareResponse:
        if not data.docPath:
            raise ClientException(detail="docPath is required")
        if data.permission not in ("read", "write"):
            raise ClientException(detail="permission must be 'read' or 'write'")
        link_uuid = create_link(data.docPath, data.permission)
        return CreateShareResponse(uuid=link_uuid)

    @delete("/{link_uuid:str}", status_code=200)
    async def revoke_share(self, link_uuid: str) -> OkResponse:
        if not delete_link(link_uuid):
            raise NotFoundException(detail="not found")
        return OkResponse()

    @get("/")
    async def list_shares(self, docPath: str | None = None) -> list[ShareLink]:
        return list_links(docPath)


# ── Share page ────────────────────────────────────────────────────────────


@get("/share/{link_uuid:str}", media_type=MediaType.HTML)
async def share_page(link_uuid: str) -> Response[str]:
    link = get_link(link_uuid)
    if not link:
        return Response("Share link not found or revoked", status_code=404, media_type=MediaType.TEXT)

    index = FRONTEND_DIST / "index.html"
    if not index.exists():
        return Response("Frontend not built", status_code=404, media_type=MediaType.TEXT)
    html = index.read_text()
    config_data = json.dumps({"uuid": link.uuid, "docPath": link.doc_path, "permission": link.permission})
    config_script = f"<script>window.__SHARE_CONFIG__ = {config_data}</script>"
    html = html.replace("</head>", f"{config_script}</head>")
    return Response(html, media_type=MediaType.HTML)


# ── Shared document WebSocket ─────────────────────────────────────────────

_MSG_SYNC = 0
_SYNC_UPDATE = 2


class ReadOnlyChannel:
    """Wraps a channel to enforce read-only access.

    Allows the initial sync handshake (sync step 1 + step 2) so the client receives the document contents,
    but drops any subsequent Yjs sync updates from the client. Awareness messages pass through.
    """

    def __init__(self, inner: LitestarWebsocketChannel):
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
            if data[0] == _MSG_SYNC and data[1] == _SYNC_UPDATE:
                log.debug("Dropped update from read-only client")
                continue
            return data

    async def send(self, message: bytes) -> None:
        await self._inner.send(message)

    async def recv(self) -> bytes:
        return await self._inner.recv()


@websocket("/ws/share/{link_uuid:str}")
async def share_sync(socket: WebSocket[Any, Any, Any], link_uuid: str) -> None:
    """Yjs sync for shared documents.

    Read-only links: the server drops Yjs update messages from the client, only allowing the initial sync
    handshake so they receive the doc. Write links: full bidirectional sync.
    """
    await socket.accept()

    link = get_link(link_uuid)
    if not link:
        await socket.close(code=4004, reason="Share link not found")
        return

    manager: SyncManager = socket.app.state.sync_manager

    if link.permission == "read":
        await manager.serve(socket, link.doc_path, wrap_channel=ReadOnlyChannel)
    else:
        await manager.serve(socket, link.doc_path)
