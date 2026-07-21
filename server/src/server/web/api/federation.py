"""Vault-share endpoints: named, revocable secrets granting another instance's client direct
access to one vault (see ``requires_vault_access`` for how secrets authenticate data routes)."""

import attr
from litestar import Controller
from litestar import delete
from litestar import get
from litestar import post
from litestar.exceptions import ClientException
from litestar.exceptions import NotAuthorizedException
from litestar.exceptions import NotFoundException
from litestar.params import FromPath
from litestar.params import FromQuery
from litestar.status_codes import HTTP_201_CREATED

from server.core.config import Config
from server.core.db import create_vault_share
from server.core.db import delete_vault_share
from server.core.db import get_vault_share
from server.core.db import list_vault_shares
from server.core.federation import FEDERATION_API_VERSION
from server.core.federation import FEDERATION_APP
from server.core.federation import build_invite_url
from server.core.vaults import vault_root
from server.models.common import OkResponse
from server.models.federation import CreateVaultShareBody
from server.models.federation import ShareInfo
from server.models.federation import VaultShare
from server.web.api.vaults import PERMISSIONS


def _with_invite_url(config: Config, share: VaultShare) -> VaultShare:
    return attr.evolve(share, invite_url=build_invite_url(config, share))


class FederationController(Controller):
    path = "/api/federation"

    @post("/shares", status_code=HTTP_201_CREATED)
    async def create_share(self, data: CreateVaultShareBody, config: Config) -> VaultShare:
        if not data.name.strip():
            raise ClientException(detail="name is required")
        if data.permission not in PERMISSIONS:
            raise ClientException(detail="permission must be 'read', 'comment' or 'write'")
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

    @get("/share-info", opt={"public": True})
    async def share_info(self, secret: FromQuery[str]) -> ShareInfo:
        """Public share metadata; a connecting client uses this to validate an invite."""
        share = get_vault_share(secret)
        if not share:
            raise NotAuthorizedException(detail="Invalid or revoked share secret")
        return ShareInfo(
            app=FEDERATION_APP,
            api_version=FEDERATION_API_VERSION,
            vault=share.vault_name,
            permission=share.permission,
        )
