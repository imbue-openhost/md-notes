"""Share link endpoints and shared document WebSocket."""

import json

from quart import Blueprint, jsonify, request, websocket

from ..config import FRONTEND_DIST
from ..db import create_link, delete_link, get_link, list_links
from .sync import get_ws_server, serve_document

bp = Blueprint("share", __name__)


# ── REST API ──────────────────────────────────────────────────────────────

@bp.route("/api/share", methods=["POST"])
async def create_share():
    """Create a share link.

    Body JSON: {"docPath": "path/to/file.md", "permission": "read"|"write"}
    Returns: {"uuid": "..."}
    """
    data = await request.get_json()
    doc_path = data.get("docPath")
    permission = data.get("permission", "read")
    if not doc_path:
        return jsonify(error="docPath is required"), 400
    if permission not in ("read", "write"):
        return jsonify(error="permission must be 'read' or 'write'"), 400

    link_uuid = create_link(doc_path, permission)
    return jsonify(uuid=link_uuid), 201


@bp.route("/api/share/<link_uuid>", methods=["DELETE"])
async def revoke_share(link_uuid: str):
    """Revoke a share link."""
    if delete_link(link_uuid):
        return jsonify(ok=True)
    return jsonify(error="not found"), 404


@bp.route("/api/share", methods=["GET"])
async def list_shares():
    """List share links, optionally filtered by docPath query param."""
    doc_path = request.args.get("docPath")
    links = list_links(doc_path)
    return jsonify(links)


# ── Share page ────────────────────────────────────────────────────────────

@bp.route("/share/<link_uuid>")
async def share_page(link_uuid: str):
    """Serve the frontend for a shared document."""
    link = get_link(link_uuid)
    if not link:
        return "Share link not found or revoked", 404

    # Serve the frontend index — the client reads the share config
    # from a script tag we inject, or via a separate API call.
    index = FRONTEND_DIST / "index.html"
    if not index.exists():
        return "Frontend not built", 404
    html = index.read_text()
    # Inject share config as a global variable — use json.dumps for proper escaping
    config_data = json.dumps({
        "uuid": link["uuid"],
        "docPath": link["doc_path"],
        "permission": link["permission"],
    })
    config_script = f"<script>window.__SHARE_CONFIG__ = {config_data}</script>"
    html = html.replace("</head>", f"{config_script}</head>")
    return html, 200, {"Content-Type": "text/html; charset=utf-8"}


# ── Shared document WebSocket ─────────────────────────────────────────────

@bp.websocket("/ws/share/<link_uuid>")
async def share_sync(link_uuid: str):
    """Yjs sync for shared documents.

    Both read and write links connect to the same room. Read-only
    enforcement happens on the client side (the editor is set to
    readOnly mode). The server syncs normally for both.
    """
    link = get_link(link_uuid)
    if not link:
        await websocket.close(4004, "Share link not found")
        return

    ws_server = get_ws_server()
    if ws_server is None:
        await websocket.close(1011, "Sync server not running")
        return

    doc_path = link["doc_path"]
    await serve_document(ws_server, websocket._get_current_object(), doc_path)
