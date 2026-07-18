from typing import Literal

import attr


@attr.s(auto_attribs=True, frozen=True)
class VaultShare:
    secret: str
    vault_name: str
    share_name: str
    permission: Literal["read", "write"]
    created_at: str
    invite_url: str = ""


@attr.s(auto_attribs=True, frozen=True)
class CreateVaultShareBody:
    vaultName: str
    name: str
    permission: Literal["read", "write"] = "read"


@attr.s(auto_attribs=True, frozen=True)
class RemoteVault:
    id: str
    name: str
    source_url: str
    vault_name: str
    secret: str
    permission: Literal["read", "write"]
    created_at: str


@attr.s(auto_attribs=True, frozen=True)
class AddRemoteVaultBody:
    sourceUrl: str
    vaultName: str
    secret: str
    name: str = ""


@attr.s(auto_attribs=True, frozen=True)
class PeerVaultInfo:
    vault_name: str
    permission: Literal["read", "write"]
    # Identity/version handshake so a connecting instance can tell it's talking to a compatible peer.
    app: str = ""
    api_version: int = 0
