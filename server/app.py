"""Quart application factory."""

from quart import Quart, send_from_directory
from quart_cors import cors

from .config import FRONTEND_DIST, VAULT_PATH


def create_app() -> Quart:
    app = Quart(__name__, static_folder=None)

    # CORS for Tauri app
    app = cors(app, allow_origin="*")

    # Ensure vault directory exists
    VAULT_PATH.mkdir(parents=True, exist_ok=True)

    # Register route blueprints
    from .routes.files import bp as files_bp

    app.register_blueprint(files_bp)

    # ── Serve frontend static files ──────────────────────────────────────
    @app.route("/")
    async def serve_index():
        index = FRONTEND_DIST / "index.html"
        if index.exists():
            return await send_from_directory(str(FRONTEND_DIST), "index.html")
        return "Frontend not built. Run `npm run build` in frontend/.", 404

    @app.route("/assets/<path:filepath>")
    async def serve_assets(filepath: str):
        """Serve Vite build assets."""
        return await send_from_directory(str(FRONTEND_DIST / "assets"), filepath)

    return app
