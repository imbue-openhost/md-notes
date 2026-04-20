"""REST endpoints for vault management.

Vaults are auto-discovered from subdirectories of VAULT_PATH.
"""

import shutil

from quart import Blueprint, jsonify, request

from ..config import VAULT_PATH

bp = Blueprint("vaults", __name__, url_prefix="/api/vaults")


def _is_valid_name(name: str) -> bool:
    return bool(name) and "/" not in name and name not in (".", "..") and not name.startswith(".")


@bp.route("", methods=["GET"])
async def list_all():
    vaults = []
    if VAULT_PATH.exists():
        for d in sorted(VAULT_PATH.iterdir()):
            if d.is_dir() and not d.name.startswith("."):
                vaults.append({"name": d.name})
    return jsonify(vaults)


@bp.route("", methods=["POST"])
async def create():
    """Create a vault. Body: {"name": "..."}."""
    data = await request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name or not _is_valid_name(name):
        return jsonify(error="name is required"), 400
    vault_dir = VAULT_PATH / name
    if vault_dir.exists():
        return jsonify({"name": name}), 200
    vault_dir.mkdir(parents=True, exist_ok=True)
    return jsonify({"name": name}), 201


@bp.route("/<vault_name>", methods=["PATCH"])
async def rename(vault_name: str):
    data = await request.get_json(silent=True) or {}
    new_name = (data.get("name") or "").strip()
    if not new_name or not _is_valid_name(new_name):
        return jsonify(error="name is required"), 400
    old_dir = VAULT_PATH / vault_name
    if not old_dir.is_dir():
        return jsonify(error="not found"), 404
    new_dir = VAULT_PATH / new_name
    if new_dir.exists():
        return jsonify(error="vault already exists"), 409
    old_dir.rename(new_dir)
    return jsonify({"name": new_name})


@bp.route("/<vault_name>", methods=["DELETE"])
async def remove(vault_name: str):
    """Delete a vault and all its files."""
    vault_dir = VAULT_PATH / vault_name
    if not vault_dir.is_dir():
        return jsonify(error="not found"), 404
    shutil.rmtree(vault_dir)
    return jsonify(ok=True)
