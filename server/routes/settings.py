"""REST endpoints for user settings (vimrc, etc.)."""

from quart import Blueprint, jsonify, request

from ..db import get_setting, set_setting

bp = Blueprint("settings", __name__, url_prefix="/api/settings")


@bp.route("/vimrc", methods=["GET"])
async def get_vimrc():
    content = get_setting("vimrc")
    if content is None:
        return jsonify(vimrc=None)
    return jsonify(vimrc=content)


@bp.route("/vimrc", methods=["PUT"])
async def save_vimrc():
    data = await request.get_json(silent=True) or {}
    content = data.get("vimrc")
    if content is None:
        return jsonify(error="vimrc is required"), 400
    set_setting("vimrc", content)
    return jsonify(ok=True)
