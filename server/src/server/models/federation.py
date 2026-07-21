import attr

from server.models.vaults import Permission


@attr.s(auto_attribs=True, frozen=True)
class VaultShare:
    secret: str
    vault_name: str
    share_name: str
    permission: Permission
    created_at: str
    invite_url: str = ""


@attr.s(auto_attribs=True, frozen=True)
class CreateVaultShareBody:
    vaultName: str
    name: str
    permission: Permission = "read"


@attr.s(auto_attribs=True, frozen=True)
class ShareInfo:
    """Public metadata for a vault share; the app/api_version handshake lets a connecting
    instance confirm it's talking to a compatible peer before storing the connection."""

    app: str
    api_version: int
    vault: str
    permission: Permission
