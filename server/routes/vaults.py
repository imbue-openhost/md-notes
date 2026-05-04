"""REST endpoints for vault management.

Vaults are auto-discovered from subdirectories of VAULT_PATH.
"""

import shutil

from litestar import Controller
from litestar import delete
from litestar import get
from litestar import patch
from litestar import post
from litestar.exceptions import ClientException
from litestar.exceptions import HTTPException
from litestar.exceptions import NotFoundException
from litestar.status_codes import HTTP_201_CREATED
from litestar.status_codes import HTTP_409_CONFLICT

from server.config import VAULT_PATH
from server.models.common import OkResponse
from server.models.vaults import Vault
from server.models.vaults import VaultBody


def _is_valid_name(name: str) -> bool:
    return bool(name) and "/" not in name and name not in (".", "..") and not name.startswith(".")


class VaultsController(Controller):
    path = "/api/vaults"

    @get("/")
    async def list_all(self) -> list[Vault]:
        if not VAULT_PATH.exists():
            return []
        return [Vault(name=d.name) for d in sorted(VAULT_PATH.iterdir()) if d.is_dir() and not d.name.startswith(".")]

    @post("/", status_code=HTTP_201_CREATED)
    async def create(self, data: VaultBody) -> Vault:
        name = data.name.strip()
        if not name or not _is_valid_name(name):
            raise ClientException(detail="name is required")
        vault_dir = VAULT_PATH / name
        if vault_dir.exists():
            # Match prior Quart behaviour: 200 when already present. Litestar can't
            # express a per-call status_code easily; the frontend treats both as success.
            return Vault(name=name)
        vault_dir.mkdir(parents=True, exist_ok=True)
        return Vault(name=name)

    @patch("/{vault_name:str}")
    async def rename(self, vault_name: str, data: VaultBody) -> Vault:
        new_name = data.name.strip()
        if not new_name or not _is_valid_name(new_name):
            raise ClientException(detail="name is required")
        old_dir = VAULT_PATH / vault_name
        if not old_dir.is_dir():
            raise NotFoundException(detail="not found")
        new_dir = VAULT_PATH / new_name
        if new_dir.exists():
            raise HTTPException(detail="vault already exists", status_code=HTTP_409_CONFLICT)
        old_dir.rename(new_dir)
        return Vault(name=new_name)

    @delete("/{vault_name:str}", status_code=200)
    async def remove(self, vault_name: str) -> OkResponse:
        vault_dir = VAULT_PATH / vault_name
        if not vault_dir.is_dir():
            raise NotFoundException(detail="not found")
        shutil.rmtree(vault_dir)
        return OkResponse()
