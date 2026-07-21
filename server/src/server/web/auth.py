"""Auth guards.

``requires_owner`` is the app-wide default (OpenHost injects the header for the logged-in owner).
Vault-scoped data routes use ``requires_vault_access`` instead: the owner has full access, and a
vault-share secret (query param) grants up to the share's permission tier on its vault — this is
what lets another instance's client talk to this instance directly.
"""

from litestar.connection import ASGIConnection
from litestar.exceptions import NotAuthorizedException
from litestar.handlers import BaseRouteHandler

from server.core.db import get_vault_share
from server.models.vaults import Permission

_PERMISSION_RANK: dict[str, int] = {"read": 0, "comment": 1, "write": 2}


def requires_owner(connection: ASGIConnection, handler: BaseRouteHandler) -> None:  # type: ignore[type-arg]
    if handler.opt.get("public"):
        return
    if connection.headers.get("x-openhost-is-owner") != "true":
        raise NotAuthorizedException()


def is_owner(connection: ASGIConnection) -> bool:  # type: ignore[type-arg]
    return connection.headers.get("x-openhost-is-owner") == "true"


def vault_permission(connection: ASGIConnection, vault_name: str) -> Permission | None:  # type: ignore[type-arg]
    """The caller's effective permission on ``vault_name``: full for the owner, the share's tier
    for a valid secret pinned to this vault, None otherwise."""
    if is_owner(connection):
        return "write"
    secret = connection.query_params.get("secret")
    share = get_vault_share(secret) if secret else None
    if share and share.vault_name == vault_name:
        return share.permission
    return None


# Async so it runs on the event loop: the sqlite connection behind get_vault_share is bound to
# the loop thread, and litestar pushes sync guards into a worker thread.
async def requires_vault_access(connection: ASGIConnection, handler: BaseRouteHandler) -> None:  # type: ignore[type-arg]
    """Guard for vault-scoped routes; the handler's ``permission`` opt sets the minimum tier."""
    required: str = handler.opt.get("permission", "write")
    vault_name = connection.path_params.get("vault_name", "")
    granted = vault_permission(connection, vault_name)
    if granted is None or _PERMISSION_RANK[granted] < _PERMISSION_RANK[required]:
        raise NotAuthorizedException()
