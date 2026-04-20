"""REST endpoints for vault management."""

from quart import Blueprint, jsonify, request

from ..config import VAULT_PATH
from ..db import (
    create_vault,
    delete_vault,
    get_vault,
    list_vaults,
    rename_vault,
)

bp = Blueprint("vaults", __name__, url_prefix="/api/vaults")


@bp.route("", methods=["GET"])
async def list_all():
    return jsonify(list_vaults())


@bp.route("", methods=["POST"])
async def create():
    """Create a vault. Body: {"name": "...", "id": "<uuid>"} (id optional)."""
    data = await request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify(error="name is required"), 400
    vault_id = data.get("id")
    if vault_id and get_vault(vault_id):
        rename_vault(vault_id, name)
        return jsonify(get_vault(vault_id)), 200
    vault = create_vault(name, vault_id=vault_id)
    (VAULT_PATH / vault["id"]).mkdir(parents=True, exist_ok=True)
    return jsonify(vault), 201


@bp.route("/<vault_id>", methods=["PATCH"])
async def rename(vault_id: str):
    data = await request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify(error="name is required"), 400
    if not rename_vault(vault_id, name):
        return jsonify(error="not found"), 404
    return jsonify(get_vault(vault_id))


@bp.route("/<vault_id>", methods=["DELETE"])
async def remove(vault_id: str):
    """Remove vault from list. Files on disk are left intact."""
    if not delete_vault(vault_id):
        return jsonify(error="not found"), 404
    return jsonify(ok=True)
