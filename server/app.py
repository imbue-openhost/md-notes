"""Quart application factory."""

from quart import Quart
from quart import abort
from quart import jsonify
from quart import request
from quart import send_from_directory
from quart import websocket as ws_ctx
from quart.typing import ResponseReturnValue
from quart_cors import cors

from server.config import API_KEY
from server.config import DB_PATH
from server.config import FRONTEND_DIST
from server.config import VAULT_PATH
from server.db import close_db
from server.db import init_db
from server.routes.files import bp as files_bp
from server.routes.settings import bp as settings_bp
from server.routes.share import bp as share_bp
from server.routes.sync import bp as sync_bp
from server.routes.sync import start_ws_server
from server.routes.sync import stop_ws_server
from server.routes.vaults import bp as vaults_bp


def create_app() -> Quart:
    app = Quart(__name__, static_folder=None)

    # CORS for Tauri app
    app = cors(app, allow_origin="*")

    # Ensure vault directory exists
    VAULT_PATH.mkdir(parents=True, exist_ok=True)

    # ── Auth middleware ──────────────────────────────────────────────────
    @app.before_request
    async def check_auth() -> ResponseReturnValue | None:
        """Require API key for all routes except /share/ and static assets.

        The key can be sent as:
          - Authorization: Bearer <key>
          - ?token=<key> query parameter (useful for WebSocket)

        Requests with the OpenHost owner header bypass the check
        (the router already authenticated them).
        """
        if not API_KEY:
            return None  # No key configured — open access (local dev)

        path = request.path

        # Public routes: share pages, static assets, health check
        if path.startswith("/share/") or path.startswith("/assets/") or path == "/health":
            return None

        # OpenHost router already authenticated the owner
        if request.headers.get("X-OpenHost-Is-Owner") == "true":
            return None

        # Check API key
        auth = request.headers.get("Authorization", "")
        token = request.args.get("token", "")
        if auth == f"Bearer {API_KEY}" or token == API_KEY:
            return None

        return jsonify(error="Unauthorized"), 401

    @app.before_websocket
    async def check_ws_auth() -> None:
        """Same auth check for WebSocket connections."""
        if not API_KEY:
            return

        path = ws_ctx.path

        # Share WebSocket is public
        if path.startswith("/ws/share/"):
            return

        # OpenHost owner header
        if ws_ctx.headers.get("X-OpenHost-Is-Owner") == "true":
            return

        # Check API key from query param (WebSocket can't send custom headers from browser)
        token = ws_ctx.args.get("token", "")
        auth = ws_ctx.headers.get("Authorization", "")
        if auth == f"Bearer {API_KEY}" or token == API_KEY:
            return

        abort(403)

    app.register_blueprint(files_bp)
    app.register_blueprint(sync_bp)
    app.register_blueprint(share_bp)
    app.register_blueprint(vaults_bp)
    app.register_blueprint(settings_bp)

    @app.before_serving
    async def startup() -> None:
        init_db(DB_PATH)
        await start_ws_server()

    @app.after_serving
    async def shutdown() -> None:
        await stop_ws_server()
        close_db()

    # ── API key endpoint ─────────────────────────────────────────────────
    @app.route("/api/key")
    async def get_api_key() -> ResponseReturnValue:
        return jsonify(api_key=API_KEY)

    # ── Health check ─────────────────────────────────────────────────────
    @app.route("/health")
    async def health() -> ResponseReturnValue:
        return "ok"

    # ── Serve frontend static files ──────────────────────────────────────
    @app.route("/")
    async def serve_index() -> ResponseReturnValue:
        index = FRONTEND_DIST / "index.html"
        if index.exists():
            return await send_from_directory(str(FRONTEND_DIST), "index.html")
        return "Frontend not built. Run `npm run build` in frontend/.", 404

    @app.route("/assets/<path:filepath>")
    async def serve_assets(filepath: str) -> ResponseReturnValue:
        """Serve Vite build assets."""
        return await send_from_directory(str(FRONTEND_DIST / "assets"), filepath)

    return app
