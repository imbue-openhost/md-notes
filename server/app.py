"""Litestar application factory."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from litestar import Litestar
from litestar import MediaType
from litestar import Request
from litestar import Response
from litestar import get
from litestar.config.cors import CORSConfig
from litestar.static_files import create_static_files_router

from server.auth import AuthMiddleware
from server.config import API_KEY
from server.config import DB_PATH
from server.config import FRONTEND_DIST
from server.config import VAULT_PATH
from server.db import close_db
from server.db import init_db
from server.routes.files import FilesController
from server.routes.settings import SettingsController
from server.routes.share import ShareController
from server.routes.share import share_page
from server.routes.share import share_sync
from server.routes.sync import start_ws_server
from server.routes.sync import stop_ws_server
from server.routes.sync import sync_doc
from server.routes.vaults import VaultsController
from server.vault import PathTraversalError


@get("/api/key")
async def get_api_key() -> dict[str, str]:
    return {"api_key": API_KEY}


@get("/health", media_type=MediaType.TEXT)
async def health() -> str:
    return "ok"


@get("/")
async def serve_index() -> Response[str]:
    index = FRONTEND_DIST / "index.html"
    if index.exists():
        return Response(index.read_text(), media_type=MediaType.HTML)
    return Response(
        "Frontend not built. Run `npm run build` in frontend/.", status_code=404, media_type=MediaType.TEXT
    )


def _path_traversal_handler(request: Request[Any, Any, Any], exc: PathTraversalError) -> Response[dict[str, str]]:
    return Response({"error": str(exc)}, status_code=403)


def _file_not_found_handler(request: Request[Any, Any, Any], exc: FileNotFoundError) -> Response[dict[str, str]]:
    return Response({"error": str(exc)}, status_code=404)


@asynccontextmanager
async def _lifespan(app: Litestar) -> AsyncIterator[None]:
    init_db(DB_PATH)
    await start_ws_server()
    try:
        yield
    finally:
        await stop_ws_server()
        close_db()


def create_app() -> Litestar:
    VAULT_PATH.mkdir(parents=True, exist_ok=True)

    assets_router = create_static_files_router(path="/assets", directories=[FRONTEND_DIST / "assets"])

    return Litestar(
        route_handlers=[
            FilesController,
            VaultsController,
            ShareController,
            SettingsController,
            sync_doc,
            share_sync,
            share_page,
            get_api_key,
            health,
            serve_index,
            assets_router,
        ],
        middleware=[AuthMiddleware],
        lifespan=[_lifespan],
        cors_config=CORSConfig(allow_origins=["*"]),
        exception_handlers={
            PathTraversalError: _path_traversal_handler,
            FileNotFoundError: _file_not_found_handler,
        },
    )
