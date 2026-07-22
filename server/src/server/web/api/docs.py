"""Document endpoints: file CRUD, search, and CRDT WebSocket, scoped per vault.

Accessible to the owner and to vault-share secrets (see ``requires_vault_access``); each handler's
``permission`` opt declares the minimum tier. Only write-tier callers get a CRDT channel that
accepts document updates — read/comment tiers sync but their updates are dropped (comments go
through the REST comment routes instead).
"""

from typing import Any

from litestar import Controller
from litestar import MediaType
from litestar import Request
from litestar import WebSocket
from litestar import delete
from litestar import get
from litestar import patch
from litestar import post
from litestar import websocket
from litestar.params import FromPath
from litestar.params import FromQuery
from litestar.status_codes import HTTP_201_CREATED

from server.core.config import Config
from server.core.files import create_directory
from server.core.files import create_file
from server.core.files import delete_file
from server.core.files import list_files
from server.core.files import read_file
from server.core.files import rename_file
from server.core.sync import ReadOnlyChannel
from server.core.sync import SyncManager
from server.core.sync import SyncNotRunning
from server.core.vaults import VaultNotFound
from server.core.vaults import vault_root
from server.models.common import OkResponse
from server.models.files import CreateFileBody
from server.models.files import FileEntry
from server.models.files import RenameBody
from server.web.api.channel import LitestarWebsocketChannel
from server.web.api.search_ws import serve_search_socket
from server.web.auth import requires_vault_access
from server.web.auth import vault_permission


class DocsController(Controller):
    path = "/api/docs/{vault_name:str}"
    guards = [requires_vault_access]
    opt = {"public": True}  # opts out of the app-wide owner guard; requires_vault_access takes over

    @get("/", opt={"permission": "read"})
    async def list_all(self, vault_name: FromPath[str], config: Config) -> list[FileEntry]:
        return list_files(vault_root(config.vault_path, vault_name))

    @get("/file", media_type=MediaType.TEXT, opt={"permission": "read"})
    async def get_file(self, vault_name: FromPath[str], path: FromQuery[str], config: Config) -> str:
        return read_file(vault_root(config.vault_path, vault_name), path)

    @websocket("/search_websocket", opt={"permission": "read"})
    async def search_websocket(
        self, socket: WebSocket[Any, Any, Any], vault_name: FromPath[str], config: Config
    ) -> None:
        await socket.accept()
        try:
            root = vault_root(config.vault_path, vault_name)
        except VaultNotFound:
            await socket.close(code=1008, reason="Vault does not exist")
            return
        await serve_search_socket(socket, root)

    @post("/file", status_code=HTTP_201_CREATED, opt={"permission": "write"})
    async def create_new_file(
        self, vault_name: FromPath[str], path: FromQuery[str], data: CreateFileBody, config: Config
    ) -> OkResponse:
        root = vault_root(config.vault_path, vault_name)
        if data.type == "dir":
            create_directory(root, path)
        else:
            create_file(root, path, data.content)
        return OkResponse()

    @patch("/file", opt={"permission": "write"})
    async def move_file(
        self,
        request: Request[Any, Any, Any],
        vault_name: FromPath[str],
        path: FromQuery[str],
        data: RenameBody,
        config: Config,
    ) -> OkResponse:
        # Flush and drop any live room first so it can't recreate the old path on its next save;
        # the flushed .md/sidecar then move together.
        manager: SyncManager = request.app.state.sync_manager
        await manager.close_rooms(f"{vault_name}/{path.lstrip('/')}", save=True, reason="Document moved")
        rename_file(vault_root(config.vault_path, vault_name), path, data.newPath)
        return OkResponse()

    @delete("/file", status_code=200, opt={"permission": "write"})
    async def remove_file(
        self, request: Request[Any, Any, Any], vault_name: FromPath[str], path: FromQuery[str], config: Config
    ) -> OkResponse:
        # Drop any live room (without saving) so it can't write the doc back after deletion.
        manager: SyncManager = request.app.state.sync_manager
        await manager.close_rooms(f"{vault_name}/{path.lstrip('/')}", save=False, reason="Document deleted")
        delete_file(vault_root(config.vault_path, vault_name), path)
        return OkResponse()

    @websocket("/crdt_websocket/{filepath:path}", opt={"permission": "read"})
    async def crdt_websocket(
        self, socket: WebSocket[Any, Any, Any], vault_name: FromPath[str], filepath: FromPath[str]
    ) -> None:
        """Yjs CRDT sync for a single document."""
        await socket.accept()
        manager: SyncManager = socket.app.state.sync_manager
        doc_path = f"{vault_name}/{filepath.lstrip('/')}"
        raw = LitestarWebsocketChannel(socket, doc_path)
        channel = raw if vault_permission(socket, vault_name) == "write" else ReadOnlyChannel(raw)
        try:
            await manager.serve(channel)
        except SyncNotRunning:
            await socket.close(code=1011, reason="Sync server not running")
        except FileNotFoundError:
            await socket.close(code=1008, reason="Document does not exist")
