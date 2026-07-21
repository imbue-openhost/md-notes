"""REST endpoints for vault management.

The vault list unifies vaults owned by this instance with connected vaults shared from other
instances; the client treats them the same. Connection records are stored verbatim from the
owner's client — the sharing instance is the authority on whether a secret actually works.
"""

from litestar import Controller
from litestar import delete
from litestar import get
from litestar import patch
from litestar import post
from litestar.exceptions import ClientException
from litestar.exceptions import NotFoundException
from litestar.params import FromPath
from litestar.status_codes import HTTP_201_CREATED

from server.core.config import Config
from server.core.db import add_connected_vault
from server.core.db import delete_connected_vault
from server.core.db import list_connected_vaults
from server.core.vaults import create_vault
from server.core.vaults import delete_vault
from server.core.vaults import list_vault_names
from server.core.vaults import rename_vault
from server.models.common import OkResponse
from server.models.vaults import ConnectVaultBody
from server.models.vaults import Vault
from server.models.vaults import VaultBody

PERMISSIONS = ("read", "comment", "write")


def owned_vault(config: Config, name: str) -> Vault:
    return Vault(id=name, name=name, host=config.app_origin, vault=name, permission="write", owned=True)


def _unique_name(config: Config, wanted: str) -> str:
    """Owned and connected vaults share one namespace in the UI; pick a free display name."""
    taken = set(list_vault_names(config.vault_path)) | {v.name for v in list_connected_vaults()}
    if wanted not in taken:
        return wanted
    n = 2
    while f"{wanted} ({n})" in taken:
        n += 1
    return f"{wanted} ({n})"


class VaultsController(Controller):
    path = "/api/vaults"

    @get("")
    async def list_all(self, config: Config) -> list[Vault]:
        owned = [owned_vault(config, name) for name in list_vault_names(config.vault_path)]
        return owned + list_connected_vaults()

    @post("", status_code=HTTP_201_CREATED)
    async def create(self, data: VaultBody, config: Config) -> Vault:
        return owned_vault(config, create_vault(config.vault_path, data.name))

    @patch("/{vault_name:str}")
    async def rename(self, vault_name: FromPath[str], data: VaultBody, config: Config) -> Vault:
        return owned_vault(config, rename_vault(config.vault_path, vault_name, data.name))

    @delete("/{vault_name:str}", status_code=200)
    async def remove(self, vault_name: FromPath[str], config: Config) -> OkResponse:
        delete_vault(config.vault_path, vault_name)
        return OkResponse()

    # ── Connections to vaults shared from other instances ───────────────

    @post("/connections", status_code=HTTP_201_CREATED)
    async def connect(self, data: ConnectVaultBody, config: Config) -> Vault:
        host = data.host.strip().rstrip("/")
        if not host.startswith(("http://", "https://")):
            raise ClientException(detail="host must be an http(s) origin")
        if not data.vault or not data.secret:
            raise ClientException(detail="vault and secret are required")
        if data.permission not in PERMISSIONS:
            raise ClientException(detail="permission must be 'read', 'comment' or 'write'")
        for existing in list_connected_vaults():
            if existing.host == host and existing.secret == data.secret:
                return existing
        name = _unique_name(config, data.name.strip() or data.vault)
        return add_connected_vault(name, host, data.vault, data.secret, data.permission)

    @delete("/connections/{connection_id:str}", status_code=200)
    async def disconnect(self, connection_id: FromPath[str]) -> OkResponse:
        if not delete_connected_vault(connection_id):
            raise NotFoundException(detail="not found")
        return OkResponse()
