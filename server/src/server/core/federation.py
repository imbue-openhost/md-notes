"""Vault federation: invite links for sharing whole vaults with other md-notes instances."""

from urllib.parse import urlencode

from server.core.config import Config
from server.models.federation import VaultShare

# Bump when the vault API changes incompatibly; connecting instances must match exactly for now.
FEDERATION_API_VERSION = 1
FEDERATION_APP = "md-notes"


def build_invite_url(config: Config, share: VaultShare) -> str:
    """An invite is a link to *this* instance; the recipient pastes it into their own md-notes."""
    if not config.app_origin:
        raise RuntimeError("app_origin not configured — cannot build invite URLs")
    params = urlencode({"vault": share.vault_name, "secret": share.secret})
    return f"{config.app_origin}/federation/connect?{params}"
