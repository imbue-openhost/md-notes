"""REST endpoints for vault management."""

from litestar import Controller
from litestar import delete
from litestar import get
from litestar import patch
from litestar import post
from litestar.status_codes import HTTP_201_CREATED

from server.core.config import VAULT_PATH
from server.core.vaults import create_vault
from server.core.vaults import delete_vault
from server.core.vaults import list_vaults
from server.core.vaults import rename_vault
from server.models.common import OkResponse
from server.models.vaults import Vault
from server.models.vaults import VaultBody


class VaultsController(Controller):
    path = "/api/vaults"

    @get("/")
    async def list_all(self) -> list[Vault]:
        return list_vaults(VAULT_PATH)

    @post("/", status_code=HTTP_201_CREATED)
    async def create(self, data: VaultBody) -> Vault:
        return create_vault(VAULT_PATH, data.name)

    @patch("/{vault_name:str}")
    async def rename(self, vault_name: str, data: VaultBody) -> Vault:
        return rename_vault(VAULT_PATH, vault_name, data.name)

    @delete("/{vault_name:str}", status_code=200)
    async def remove(self, vault_name: str) -> OkResponse:
        delete_vault(VAULT_PATH, vault_name)
        return OkResponse()
