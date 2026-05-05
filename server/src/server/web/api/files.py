"""REST endpoints for file operations, scoped per vault."""

from litestar import Controller
from litestar import MediaType
from litestar import delete
from litestar import get
from litestar import patch
from litestar import post
from litestar.status_codes import HTTP_201_CREATED

from server.core.config import Config
from server.core.files import create_directory
from server.core.files import delete_file
from server.core.files import list_files
from server.core.files import read_file
from server.core.files import rename_file
from server.core.files import write_file
from server.core.vaults import vault_root
from server.models.common import OkResponse
from server.models.files import CreateFileBody
from server.models.files import FileEntry
from server.models.files import RenameBody


class FilesController(Controller):
    path = "/api/vaults/{vault_name:str}/files"

    @get("/")
    async def list_all(self, vault_name: str, config: Config) -> list[FileEntry]:
        return list_files(vault_root(config.vault_path, vault_name))

    @get("/{filepath:path}", media_type=MediaType.TEXT)
    async def get_file(self, vault_name: str, filepath: str, config: Config) -> str:
        return read_file(vault_root(config.vault_path, vault_name), filepath.lstrip("/"))

    @post("/{filepath:path}", status_code=HTTP_201_CREATED)
    async def create_file(self, vault_name: str, filepath: str, data: CreateFileBody, config: Config) -> OkResponse:
        root = vault_root(config.vault_path, vault_name)
        rel = filepath.lstrip("/")
        if data.type == "dir":
            create_directory(root, rel)
        else:
            write_file(root, rel, data.content)
        return OkResponse()

    @patch("/{filepath:path}")
    async def move_file(self, vault_name: str, filepath: str, data: RenameBody, config: Config) -> OkResponse:
        rename_file(vault_root(config.vault_path, vault_name), filepath.lstrip("/"), data.newPath)
        return OkResponse()

    @delete("/{filepath:path}", status_code=200)
    async def remove_file(self, vault_name: str, filepath: str, config: Config) -> OkResponse:
        delete_file(vault_root(config.vault_path, vault_name), filepath.lstrip("/"))
        return OkResponse()
