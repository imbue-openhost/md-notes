"""REST endpoints for vault management."""

from litestar import Controller
from litestar import delete
from litestar import get
from litestar import patch
from litestar import post
from litestar.status_codes import HTTP_201_CREATED

from server.core.config import Config
from server.core.vaults import create_vault
from server.core.vaults import delete_vault
from server.core.vaults import list_vaults
from server.core.vaults import rename_vault
from server.models.common import OkResponse
from server.models.vaults import Vault
from server.models.vaults import VaultBody


class VaultsController(Controller):
    path = "/api/vaults"

    @get("")
    async def list_all(self, config: Config) -> list[Vault]:
        return list_vaults(config.vault_path)

    @post("", status_code=HTTP_201_CREATED)
    async def create(self, data: VaultBody, config: Config) -> Vault:
        return create_vault(config.vault_path, data.name)

    @patch("/{vault_name:str}")
    async def rename(self, vault_name: str, data: VaultBody, config: Config) -> Vault:
        return rename_vault(config.vault_path, vault_name, data.name)

    @delete("/{vault_name:str}", status_code=200)
    async def remove(self, vault_name: str, config: Config) -> OkResponse:
        delete_vault(config.vault_path, vault_name)
        return OkResponse()
