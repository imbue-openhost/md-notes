"""Document endpoints: file CRUD, search, and CRDT WebSocket, scoped per vault."""

import threading
from functools import partial
from typing import Any

import anyio
import attr
from litestar import Controller
from litestar import MediaType
from litestar import WebSocket
from litestar import delete
from litestar import get
from litestar import patch
from litestar import post
from litestar import websocket
from litestar.exceptions import WebSocketDisconnect
from litestar.status_codes import HTTP_201_CREATED
from loguru import logger

from server.core.config import Config
from server.core.files import create_directory
from server.core.files import delete_file
from server.core.files import list_files
from server.core.files import read_file
from server.core.files import rename_file
from server.core.files import write_file
from server.core.search import SearchCancelled
from server.core.search import search_vault
from server.core.sync import SyncManager
from server.core.sync import SyncNotRunning
from server.core.vaults import VaultNotFound
from server.core.vaults import vault_root
from server.models.common import OkResponse
from server.models.files import CreateFileBody
from server.models.files import FileEntry
from server.models.files import RenameBody
from server.models.search import SearchHit
from server.web.api.channel import LitestarWebsocketChannel


class DocsController(Controller):
    path = "/api/docs/{vault_name:str}"

    @get("/")
    async def list_all(self, vault_name: str, config: Config) -> list[FileEntry]:
        return list_files(vault_root(config.vault_path, vault_name))

    @get("/file", media_type=MediaType.TEXT)
    async def get_file(self, vault_name: str, path: str, config: Config) -> str:
        return read_file(vault_root(config.vault_path, vault_name), path)

    @get("/search", sync_to_thread=True)
    def search(
        self, vault_name: str, q: str, config: Config, limit: int = 50, normalize: bool = True
    ) -> list[SearchHit]:
        """One-shot search for API clients; the interactive UI uses search_websocket instead.

        Sync handler on the threadpool (unlike the async handlers above) because the scan is CPU-bound.
        """
        return search_vault(vault_root(config.vault_path, vault_name), q, limit, normalize)

    @websocket("/search_websocket")
    async def search_websocket(self, socket: WebSocket[Any, Any, Any], vault_name: str, config: Config) -> None:
        """Interactive search session: one socket per palette, one query message per keystroke.

        Client sends {"id", "q", "normalize", "limit"}; server replies {"id", "hits"}. Each incoming
        query cancels the running scan at its next file/chunk boundary and starts a new one, so only
        the latest query does full work — this latest-wins coalescing replaces client-side debouncing.
        Superseded scans send no reply.
        """
        await socket.accept()
        try:
            root = vault_root(config.vault_path, vault_name)
        except VaultNotFound:
            await socket.close(code=1008, reason="Vault does not exist")
            return

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
        doc_path = f"{vault_name}/{filepath.lstrip('/')}"
        channel = LitestarWebsocketChannel(socket, doc_path)
        try:
            await manager.serve(channel)
        except SyncNotRunning:
            await socket.close(code=1011, reason="Sync server not running")
        except FileNotFoundError:
            await socket.close(code=1008, reason="Document does not exist")
