"""REST endpoints for file operations, scoped per vault."""

from pathlib import Path

from litestar import Controller
from litestar import MediaType
from litestar import delete
from litestar import get
from litestar import patch
from litestar import post
from litestar.exceptions import NotFoundException
from litestar.status_codes import HTTP_201_CREATED

from server.config import VAULT_PATH
from server.models.common import OkResponse
from server.models.files import CreateFileBody
from server.models.files import FileEntry
from server.models.files import RenameBody
from server.vault import create_directory
from server.vault import delete_file
from server.vault import list_files
from server.vault import read_file
from server.vault import rename_file
from server.vault import write_file


def _vault_root(vault_name: str) -> Path:
    root = VAULT_PATH / vault_name
    if not root.is_dir():
        raise NotFoundException(detail="vault not found")
    return root


class FilesController(Controller):
    path = "/api/vaults/{vault_name:str}/files"

    @get("/")
    async def list_all(self, vault_name: str) -> list[FileEntry]:
        return list_files(_vault_root(vault_name))

    @get("/{filepath:path}", media_type=MediaType.TEXT)
    async def get_file(self, vault_name: str, filepath: str) -> str:
        root = _vault_root(vault_name)
        return read_file(root, filepath.lstrip("/"))

    @post("/{filepath:path}", status_code=HTTP_201_CREATED)
    async def create_file(self, vault_name: str, filepath: str, data: CreateFileBody) -> OkResponse:
        root = _vault_root(vault_name)
        rel = filepath.lstrip("/")
        if data.type == "dir":
            create_directory(root, rel)
        else:
            write_file(root, rel, data.content)
        return OkResponse()

    @patch("/{filepath:path}")
    async def move_file(self, vault_name: str, filepath: str, data: RenameBody) -> OkResponse:
        root = _vault_root(vault_name)
        rename_file(root, filepath.lstrip("/"), data.newPath)
        return OkResponse()

    @delete("/{filepath:path}", status_code=200)
    async def remove_file(self, vault_name: str, filepath: str) -> OkResponse:
        root = _vault_root(vault_name)
        delete_file(root, filepath.lstrip("/"))
        return OkResponse()
