"""Vault federation endpoints.

Owner routes manage this instance's outgoing shares and stored remote vaults. Peer routes are public at
the router level and serve a shared vault to other instances; the share secret is the capability, and the
vault is pinned server-side by the secret so a peer can never reach other vaults.
"""

from typing import Any

import attr
from litestar import Controller
from litestar import MediaType
from litestar import WebSocket
from litestar import delete
from litestar import get
from litestar import patch
from litestar import post
from litestar import websocket
from litestar.exceptions import ClientException
from litestar.exceptions import NotAuthorizedException
from litestar.exceptions import NotFoundException
from litestar.exceptions import PermissionDeniedException
from litestar.params import FromPath
from litestar.params import FromQuery
from litestar.status_codes import HTTP_201_CREATED

from server.core.config import Config
from server.core.db import add_remote_vault
from server.core.db import create_vault_share
from server.core.db import delete_remote_vault
from server.core.db import delete_vault_share
from server.core.db import get_vault_share
from server.core.db import list_remote_vaults
from server.core.db import list_vault_shares
from server.core.federation import FEDERATION_API_VERSION
from server.core.federation import FEDERATION_APP
from server.core.federation import build_invite_url
from server.core.federation import fetch_peer_vault_info
from server.core.federation import normalize_source_url
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
from server.core.vaults import list_vaults
from server.core.vaults import vault_root
from server.models.common import OkResponse
from server.models.federation import AddRemoteVaultBody
from server.models.federation import CreateVaultShareBody
from server.models.federation import PeerVaultInfo
from server.models.federation import RemoteVault
from server.models.federation import VaultShare
from server.models.files import CreateFileBody
from server.models.files import FileEntry
from server.models.files import RenameBody
from server.web.api.channel import LitestarWebsocketChannel
from server.web.api.search_ws import serve_search_socket


def _require_share(secret: str) -> VaultShare:
    share = get_vault_share(secret)
    if not share:
        raise NotAuthorizedException(detail="Invalid or revoked share secret")
    return share


def _require_write(share: VaultShare) -> None:
    if share.permission != "write":
        raise PermissionDeniedException(detail="This share is read-only")


def _with_invite_url(config: Config, share: VaultShare) -> VaultShare:
    return attr.evolve(share, invite_url=build_invite_url(config, share))


def _unique_vault_display_name(config: Config, wanted: str) -> str:
    """Local vault dirs and remote vault names share one namespace in the UI; pick a free name."""
    taken = {v.name for v in list_vaults(config.vault_path)} | {r.name for r in list_remote_vaults()}
    if wanted not in taken:
        return wanted
    n = 2
    while f"{wanted} ({n})" in taken:
        n += 1
    return f"{wanted} ({n})"


class FederationController(Controller):
    path = "/api/federation"

    # ── Owner: outgoing vault shares ─────────────────────────────────────

    @post("/shares", status_code=HTTP_201_CREATED)
    async def create_share(self, data: CreateVaultShareBody, config: Config) -> VaultShare:
        if not data.name.strip():
            raise ClientException(detail="name is required")
        if data.permission not in ("read", "write"):
            raise ClientException(detail="permission must be 'read' or 'write'")
        vault_root(config.vault_path, data.vaultName)  # raises VaultNotFound → 404
        share = create_vault_share(data.vaultName, data.name.strip(), data.permission)
        return _with_invite_url(config, share)

    @get("/shares")
    async def list_shares(self, config: Config, vaultName: FromQuery[str | None] = None) -> list[VaultShare]:
        return [_with_invite_url(config, s) for s in list_vault_shares(vaultName)]

    @delete("/shares/{secret:str}", status_code=200)
    async def revoke_share(self, secret: FromPath[str]) -> OkResponse:
        if not delete_vault_share(secret):
            raise NotFoundException(detail="not found")
        return OkResponse()

    # ── Owner: stored remote vaults ──────────────────────────────────────

    @post("/remotes", status_code=HTTP_201_CREATED)
    async def add_remote(self, data: AddRemoteVaultBody, config: Config) -> RemoteVault:
        source_url = normalize_source_url(data.sourceUrl)
        info = await fetch_peer_vault_info(source_url, data.secret, config.router_url)
        if data.vaultName and info.vault_name != data.vaultName:
            raise ClientException(detail=f"Share is for vault '{info.vault_name}', not '{data.vaultName}'")
        for existing in list_remote_vaults():
            if existing.source_url == source_url and existing.secret == data.secret:
                return existing
        name = _unique_vault_display_name(config, data.name.strip() or info.vault_name)
        return add_remote_vault(name, source_url, info.vault_name, data.secret, info.permission)

    @get("/remotes")
    async def list_remotes(self) -> list[RemoteVault]:
        return list_remote_vaults()

    @delete("/remotes/{vault_id:str}", status_code=200)
    async def remove_remote(self, vault_id: FromPath[str]) -> OkResponse:
        if not delete_remote_vault(vault_id):
            raise NotFoundException(detail="not found")
        return OkResponse()

    # ── Peer: secret-authenticated access to a shared vault ─────────────

    @get("/peer/vault", opt={"public": True})
    async def peer_vault(self, secret: FromQuery[str]) -> PeerVaultInfo:
        share = _require_share(secret)
        return PeerVaultInfo(
            vault_name=share.vault_name,
            permission=share.permission,
            app=FEDERATION_APP,
            api_version=FEDERATION_API_VERSION,
        )

    @get("/peer/docs", opt={"public": True})
    async def peer_list_docs(self, secret: FromQuery[str], config: Config) -> list[FileEntry]:
        share = _require_share(secret)
        return list_files(vault_root(config.vault_path, share.vault_name))

    @get("/peer/docs/file", media_type=MediaType.TEXT, opt={"public": True})
    async def peer_get_file(self, secret: FromQuery[str], path: FromQuery[str], config: Config) -> str:
        share = _require_share(secret)
        return read_file(vault_root(config.vault_path, share.vault_name), path)

    @post("/peer/docs/file", status_code=HTTP_201_CREATED, opt={"public": True})
    async def peer_create_file(
        self, secret: FromQuery[str], path: FromQuery[str], data: CreateFileBody, config: Config
    ) -> OkResponse:
        share = _require_share(secret)
        _require_write(share)
        root = vault_root(config.vault_path, share.vault_name)
        if data.type == "dir":
            create_directory(root, path)
        else:
            create_file(root, path, data.content)
        return OkResponse()

    @patch("/peer/docs/file", opt={"public": True})
    async def peer_move_file(
        self, secret: FromQuery[str], path: FromQuery[str], data: RenameBody, config: Config
    ) -> OkResponse:
        share = _require_share(secret)
        _require_write(share)
        rename_file(vault_root(config.vault_path, share.vault_name), path, data.newPath)
        return OkResponse()

    @delete("/peer/docs/file", status_code=200, opt={"public": True})
    async def peer_remove_file(self, secret: FromQuery[str], path: FromQuery[str], config: Config) -> OkResponse:
        share = _require_share(secret)
        _require_write(share)
        delete_file(vault_root(config.vault_path, share.vault_name), path)
        return OkResponse()

    @websocket("/peer/crdt_websocket/{filepath:path}", opt={"public": True})
    async def peer_crdt_websocket(
        self, socket: WebSocket[Any, Any, Any], filepath: FromPath[str], secret: FromQuery[str]
    ) -> None:
        """Yjs CRDT sync for a doc in a shared vault; read-only shares get update-dropping channels."""
        await socket.accept()
        share = get_vault_share(secret)
        if not share:
            await socket.close(code=4001, reason="Invalid or revoked share secret")
            return
        manager: SyncManager = socket.app.state.sync_manager
        doc_path = f"{share.vault_name}/{filepath.lstrip('/')}"
        raw = LitestarWebsocketChannel(socket, doc_path)
        channel = ReadOnlyChannel(raw) if share.permission == "read" else raw
        try:
            await manager.serve(channel)
        except SyncNotRunning:
            await socket.close(code=1011, reason="Sync server not running")
        except FileNotFoundError:
            await socket.close(code=1008, reason="Document does not exist")

    @websocket("/peer/search_websocket", opt={"public": True})
    async def peer_search_websocket(
        self, socket: WebSocket[Any, Any, Any], secret: FromQuery[str], config: Config
    ) -> None:
        await socket.accept()
        share = get_vault_share(secret)
        if not share:
            await socket.close(code=4001, reason="Invalid or revoked share secret")
            return
        try:
            root = vault_root(config.vault_path, share.vault_name)
        except VaultNotFound:
            await socket.close(code=1008, reason="Vault does not exist")
            return
        await serve_search_socket(socket, root)
