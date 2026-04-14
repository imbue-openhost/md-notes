"""REST endpoints for file operations."""

from quart import Blueprint, jsonify, request

from ..config import VAULT_PATH
from ..vault import (
    PathTraversalError,
    create_directory,
    delete_file,
    list_files,
    read_file,
    rename_file,
    write_file,
)

bp = Blueprint("files", __name__, url_prefix="/api/files")


@bp.errorhandler(PathTraversalError)
async def handle_traversal(exc: PathTraversalError):
    return jsonify(error=str(exc)), 403


@bp.errorhandler(FileNotFoundError)
async def handle_not_found(exc: FileNotFoundError):
    return jsonify(error=str(exc)), 404


@bp.route("", methods=["GET"])
async def list_all():
    """GET /api/files — recursive directory listing.

    Optional query param: ?root=subdir to list a subdirectory.
    """
    root = request.args.get("root", "")
    base = VAULT_PATH
    if root:
        base = (VAULT_PATH / root).resolve()
        if not str(base).startswith(str(VAULT_PATH.resolve())):
            return jsonify(error="Invalid root"), 403
        base.mkdir(parents=True, exist_ok=True)
    tree = list_files(base)
    return jsonify(tree)


@bp.route("/<path:filepath>", methods=["GET"])
async def get_file(filepath: str):
    """GET /api/files/<path> — file content as text."""
    content = read_file(VAULT_PATH, filepath)
    return content, 200, {"Content-Type": "text/plain; charset=utf-8"}


@bp.route("/<path:filepath>", methods=["POST"])
async def create_file(filepath: str):
    """POST /api/files/<path> — create file or directory.

    Body (optional JSON): {"content": "...", "type": "file"|"dir"}
    """
    data = await request.get_json(silent=True) or {}
    file_type = data.get("type", "file")

    if file_type == "dir":
        create_directory(VAULT_PATH, filepath)
    else:
        content = data.get("content", "")
        write_file(VAULT_PATH, filepath, content)

    return jsonify(ok=True), 201


@bp.route("/<path:filepath>", methods=["PATCH"])
async def move_file(filepath: str):
    """PATCH /api/files/<path> — rename/move.

    Body JSON: {"newPath": "new/path.md"}
    """
    data = await request.get_json()
    new_path = data.get("newPath")
    if not new_path:
        return jsonify(error="newPath is required"), 400
    rename_file(VAULT_PATH, filepath, new_path)
    return jsonify(ok=True)


@bp.route("/<path:filepath>", methods=["DELETE"])
async def remove_file(filepath: str):
    """DELETE /api/files/<path> — delete file or empty directory."""
    delete_file(VAULT_PATH, filepath)
    return jsonify(ok=True)
