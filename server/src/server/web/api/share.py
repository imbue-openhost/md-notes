"""Share-link REST endpoints and the shared-document WebSocket route."""

from typing import Any

from litestar import Controller
from litestar import WebSocket
from litestar import delete
from litestar import get
from litestar import post
from litestar import websocket
from litestar.exceptions import ClientException
from litestar.exceptions import NotFoundException
from litestar.status_codes import HTTP_201_CREATED

from server.core.db import create_link
from server.core.db import delete_link
from server.core.db import get_link
from server.core.db import list_links
from server.core.sync import ReadOnlyChannel
from server.core.sync import SyncManager
from server.core.sync import SyncNotRunning
from server.models.common import OkResponse
from server.models.share import CreateShareBody
from server.models.share import CreateShareResponse
from server.models.share import ShareLink
from server.web.api.sync import LitestarWebsocketChannel


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


@get("/share/{link_uuid:str}/info")
async def share_info(link_uuid: str) -> ShareLink:
    """Public lookup of share-link metadata. The UUID is the capability — no auth required."""
    link = get_link(link_uuid)
    if not link:
        raise NotFoundException(detail="not found")
    return link


@websocket("/ws/share/{link_uuid:str}")
async def share_sync(socket: WebSocket[Any, Any, Any], link_uuid: str) -> None:
    """Yjs sync for shared documents.

    Read-only links: server drops Yjs update messages from the client; only the initial sync handshake passes
    through. Write links: full bidirectional sync.
    """
    await socket.accept()

    link = get_link(link_uuid)
    if not link:
        await socket.close(code=4004, reason="Share link not found")
        return

    manager: SyncManager = socket.app.state.sync_manager
    raw = LitestarWebsocketChannel(socket, link.doc_path)
    channel = ReadOnlyChannel(raw) if link.permission == "read" else raw
    try:
        await manager.serve(channel)
    except SyncNotRunning:
        await socket.close(code=1011, reason="Sync server not running")
