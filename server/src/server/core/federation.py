"""Vault federation: invite links and validation of remote md-notes instances."""

from urllib.parse import urlencode

import httpx

from server.core.config import Config
from server.models.federation import PeerVaultInfo
from server.models.federation import VaultShare

# Bump when the peer API changes incompatibly; connecting instances must match exactly for now.
FEDERATION_API_VERSION = 1
FEDERATION_APP = "md-notes"


class RemoteVaultError(Exception):
    """The remote instance rejected or failed the validation request."""


def build_invite_url(config: Config, share: VaultShare) -> str:
    """An invite is a link to *this* instance; the recipient pastes it into their own md-notes."""
    if not config.app_origin:
        raise RuntimeError("app_origin not configured — cannot build invite URLs")
    params = urlencode({"vault": share.vault_name, "secret": share.secret})
    return f"{config.app_origin}/federation/connect?{params}"


def normalize_source_url(source: str) -> str:
    """Accept bare hosts (assumed https) or full http(s) origins; strip trailing slashes."""
    source = source.strip().rstrip("/")
    if not source:
        raise RemoteVaultError("source URL is required")
    if not source.startswith(("http://", "https://")):
        source = f"https://{source}"
    return source


def parse_peer_vault_info(data: object, source_url: str) -> PeerVaultInfo:
    """Validate a peer /vault response, including the app identity / API version handshake."""
    if not isinstance(data, dict):
        raise RemoteVaultError(f"{source_url} returned an invalid federation response")
    if data.get("app") != FEDERATION_APP:
        raise RemoteVaultError(f"{source_url} is not an md-notes instance")
    if data.get("api_version") != FEDERATION_API_VERSION:
        raise RemoteVaultError(
            f"{source_url} speaks federation API version {data.get('api_version')}, "
            f"but this instance requires version {FEDERATION_API_VERSION} — upgrade one of the instances"
        )
    vault_name = data.get("vault_name")
    permission = data.get("permission")
    if not isinstance(vault_name, str) or permission not in ("read", "write"):
        raise RemoteVaultError(f"{source_url} returned an invalid federation response")
    return PeerVaultInfo(vault_name=vault_name, permission=permission)


async def fetch_peer_vault_info(source_url: str, secret: str) -> PeerVaultInfo:
    """Validate a share against the source instance and return its metadata."""
    url = f"{source_url}/api/federation/peer/vault"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, params={"secret": secret})
    except httpx.HTTPError as e:
        raise RemoteVaultError(f"Could not reach {source_url}: {e}") from e
    if response.status_code == 401:
        raise RemoteVaultError("The share secret was rejected — the share may have been revoked")
    if response.status_code != 200:
        raise RemoteVaultError(f"{source_url} returned HTTP {response.status_code}")
    try:
        data = response.json()
    except ValueError as e:
        raise RemoteVaultError(f"{source_url} returned an invalid federation response") from e
    return parse_peer_vault_info(data, source_url)
