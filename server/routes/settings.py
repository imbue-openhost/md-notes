"""REST endpoints for user settings (vimrc, etc.)."""

from quart import Blueprint
from quart import jsonify
from quart import request
from quart.typing import ResponseReturnValue

from server.db import get_setting
from server.db import set_setting

bp = Blueprint("settings", __name__, url_prefix="/api/settings")


@bp.route("/vimrc", methods=["GET"])
async def get_vimrc() -> ResponseReturnValue:
    content = get_setting("vimrc")
    if content is None:
        return jsonify(vimrc=None)
    return jsonify(vimrc=content)


@bp.route("/vimrc", methods=["PUT"])
async def save_vimrc() -> ResponseReturnValue:
    data = await request.get_json(silent=True) or {}
    content = data.get("vimrc")
    if content is None:
        return jsonify(error="vimrc is required"), 400
    set_setting("vimrc", content)
    return jsonify(ok=True)
