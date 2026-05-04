"""REST endpoints for file operations, scoped per vault."""

from pathlib import Path

from quart import Blueprint
from quart import jsonify
from quart import request
from quart.typing import ResponseReturnValue

from server.config import VAULT_PATH
from server.vault import PathTraversalError
from server.vault import create_directory
from server.vault import delete_file
from server.vault import list_files
from server.vault import read_file
from server.vault import rename_file
from server.vault import write_file

bp = Blueprint("files", __name__, url_prefix="/api/vaults/<vault_name>/files")


@bp.errorhandler(PathTraversalError)
async def handle_traversal(exc: PathTraversalError) -> ResponseReturnValue:
    return jsonify(error=str(exc)), 403


@bp.errorhandler(FileNotFoundError)
async def handle_not_found(exc: FileNotFoundError) -> ResponseReturnValue:
    return jsonify(error=str(exc)), 404


def _vault_root(vault_name: str) -> Path | None:
    """Return the on-disk root for a vault, or None if the directory doesn't exist."""
    root = VAULT_PATH / vault_name
    if not root.is_dir():
        return None
    return root


@bp.route("", methods=["GET"])
async def list_all(vault_name: str) -> ResponseReturnValue:
    root = _vault_root(vault_name)
    if root is None:
        return jsonify(error="vault not found"), 404
    return jsonify(list_files(root))


@bp.route("/<path:filepath>", methods=["GET"])
async def get_file(vault_name: str, filepath: str) -> ResponseReturnValue:
    root = _vault_root(vault_name)
    if root is None:
        return jsonify(error="vault not found"), 404
    content = read_file(root, filepath)
    return content, 200, {"Content-Type": "text/plain; charset=utf-8"}


@bp.route("/<path:filepath>", methods=["POST"])
async def create_file(vault_name: str, filepath: str) -> ResponseReturnValue:
    root = _vault_root(vault_name)
    if root is None:
        return jsonify(error="vault not found"), 404
    data = await request.get_json(silent=True) or {}
    file_type = data.get("type", "file")
    if file_type == "dir":
        create_directory(root, filepath)
    else:
        write_file(root, filepath, data.get("content", ""))
    return jsonify(ok=True), 201


@bp.route("/<path:filepath>", methods=["PATCH"])
async def move_file(vault_name: str, filepath: str) -> ResponseReturnValue:
    root = _vault_root(vault_name)
    if root is None:
        return jsonify(error="vault not found"), 404
    data = await request.get_json()
    new_path = data.get("newPath")
    if not new_path:
        return jsonify(error="newPath is required"), 400
    rename_file(root, filepath, new_path)
    return jsonify(ok=True)


@bp.route("/<path:filepath>", methods=["DELETE"])
async def remove_file(vault_name: str, filepath: str) -> ResponseReturnValue:
    root = _vault_root(vault_name)
    if root is None:
        return jsonify(error="vault not found"), 404
    delete_file(root, filepath)
    return jsonify(ok=True)
