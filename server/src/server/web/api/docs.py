"""Document endpoints: file CRUD and CRDT WebSocket, scoped per vault."""

from typing import Any

from litestar import Controller
from litestar import MediaType
from litestar import WebSocket
from litestar import delete
from litestar import get
from litestar import patch
from litestar import post
from litestar import websocket
from litestar.status_codes import HTTP_201_CREATED

from server.core.config import Config
from server.core.files import create_directory
from server.core.files import delete_file
from server.core.files import list_files
from server.core.files import read_file
from server.core.files import rename_file
from server.core.files import write_file
from server.core.sync import SyncManager
from server.core.sync import SyncNotRunning
from server.core.vaults import vault_root
from server.models.common import OkResponse
from server.models.files import CreateFileBody
from server.models.files import FileEntry
from server.models.files import RenameBody
from server.web.api.channel import LitestarWebsocketChannel


class DocsController(Controller):
    path = "/api/docs/{vault_name:str}"

    @get("/")
    async def list_all(self, vault_name: str, config: Config) -> list[FileEntry]:
        return list_files(vault_root(config.vault_path, vault_name))

    @get("/file", media_type=MediaType.TEXT)
    async def get_file(self, vault_name: str, path: str, config: Config) -> str:
        return read_file(vault_root(config.vault_path, vault_name), path)

    @post("/file", status_code=HTTP_201_CREATED)
    async def create_file(self, vault_name: str, path: str, data: CreateFileBody, config: Config) -> OkResponse:
        root = vault_root(config.vault_path, vault_name)
        if data.type == "dir":
            create_directory(root, path)
        else:
            write_file(root, path, data.content)
        return OkResponse()

    @patch("/file")
    async def move_file(self, vault_name: str, path: str, data: RenameBody, config: Config) -> OkResponse:
        rename_file(vault_root(config.vault_path, vault_name), path, data.newPath)
        return OkResponse()

    @delete("/file", status_code=200)
    async def remove_file(self, vault_name: str, path: str, config: Config) -> OkResponse:
        delete_file(vault_root(config.vault_path, vault_name), path)
        return OkResponse()

    @websocket("/crdt_websocket/{filepath:path}")
    async def crdt_websocket(self, socket: WebSocket[Any, Any, Any], vault_name: str, filepath: str) -> None:
        """Yjs CRDT sync for a single document."""
        await socket.accept()
        manager: SyncManager = socket.app.state.sync_manager
        doc_path = f"{vault_name}/{filepath}"
        channel = LitestarWebsocketChannel(socket, doc_path)
        try:
            await manager.serve(channel)
        except SyncNotRunning:
            await socket.close(code=1011, reason="Sync server not running")
