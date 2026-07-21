from typing import Literal

import attr

Permission = Literal["read", "comment", "write"]


@attr.s(auto_attribs=True, frozen=True)
class Vault:
    """A vault the client can open: owned ones live on this instance, connected ones on another.

    The client treats both uniformly — data requests go to ``host`` with ``secret`` attached when
    present; ``owned`` only matters for management operations (delete vs disconnect, sharing).
    """

    # Stable local key: the vault name for owned vaults, the connection id for connected ones.
    id: str
    # Display name, unique across this instance's vault list.
    name: str
    # Origin serving the vault's API (this instance's own origin for owned vaults).
    host: str
    # Vault name on the host (URL path segment); equals ``name`` for owned vaults.
    vault: str
    permission: Permission
    owned: bool
    secret: str | None = None


@attr.s(auto_attribs=True, frozen=True)
class VaultBody:
    name: str


@attr.s(auto_attribs=True, frozen=True)
class ConnectVaultBody:
    host: str
    vault: str
    secret: str
    permission: Permission
    name: str = ""
