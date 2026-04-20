"""REST endpoints for vault management."""

from quart import Blueprint, jsonify, request

from ..config import VAULT_PATH
from ..db import create_vault, delete_vault, get_vault, list_vaults, rename_vault

bp = Blueprint("vaults", __name__, url_prefix="/api/vaults")


@bp.route("", methods=["GET"])
async def list_all():
    return jsonify(list_vaults())


@bp.route("", methods=["POST"])
async def create():
    """Create a vault. Body: {"name": "..."}."""
    data = await request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify(error="name is required"), 400
    existing = get_vault(name)
    if existing:
        return jsonify(existing), 200
    vault = create_vault(name)
    (VAULT_PATH / name).mkdir(parents=True, exist_ok=True)
    return jsonify(vault), 201


@bp.route("/<vault_name>", methods=["PATCH"])
async def rename(vault_name: str):
    data = await request.get_json(silent=True) or {}
    new_name = (data.get("name") or "").strip()
    if not new_name:
        return jsonify(error="name is required"), 400
    if not rename_vault(vault_name, new_name):
        return jsonify(error="not found"), 404
    old_dir = VAULT_PATH / vault_name
    new_dir = VAULT_PATH / new_name
    if old_dir.exists() and not new_dir.exists():
        old_dir.rename(new_dir)
    return jsonify(get_vault(new_name))


@bp.route("/<vault_name>", methods=["DELETE"])
async def remove(vault_name: str):
    """Remove vault from list. Files on disk are left intact."""
    if not delete_vault(vault_name):
        return jsonify(error="not found"), 404
    return jsonify(ok=True)
