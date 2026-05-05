"""Litestar application factory."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from litestar import Litestar
from litestar import Request
from litestar import Response
from litestar.config.cors import CORSConfig
from litestar.di import Provide
from litestar.static_files import create_static_files_router

from server.core.config import Config
from server.core.db import close_db
from server.core.db import init_db
from server.core.files import PathTraversalError
from server.core.sync import SyncManager
from server.core.vaults import InvalidVaultName
from server.core.vaults import VaultAlreadyExists
from server.core.vaults import VaultNotFound
from server.web.api.files import FilesController
from server.web.api.settings import SettingsController
from server.web.api.share import ShareController
from server.web.api.share import share_info
from server.web.api.share import share_sync
from server.web.api.sync import sync_doc
from server.web.api.vaults import VaultsController
from server.web.auth import AuthMiddleware
from server.web.pages.index import health
from server.web.pages.index import serve_index
from server.web.pages.share import share_page


def _path_traversal_handler(request: Request[Any, Any, Any], exc: PathTraversalError) -> Response[dict[str, str]]:
    return Response({"error": str(exc)}, status_code=403)


def _file_not_found_handler(request: Request[Any, Any, Any], exc: FileNotFoundError) -> Response[dict[str, str]]:
    return Response({"error": str(exc)}, status_code=404)


def _invalid_vault_name_handler(request: Request[Any, Any, Any], exc: InvalidVaultName) -> Response[dict[str, str]]:
    return Response({"error": "name is required"}, status_code=400)


def _vault_not_found_handler(request: Request[Any, Any, Any], exc: VaultNotFound) -> Response[dict[str, str]]:
    return Response({"error": "not found"}, status_code=404)


def _vault_already_exists_handler(
    request: Request[Any, Any, Any], exc: VaultAlreadyExists
) -> Response[dict[str, str]]:
    return Response({"error": "vault already exists"}, status_code=409)


def create_app(config: Config) -> Litestar:
    config.vault_path.mkdir(parents=True, exist_ok=True)

    assets_router = create_static_files_router(path="/assets", directories=[config.frontend_dist / "assets"])

    @asynccontextmanager
    async def lifespan(app: Litestar) -> AsyncIterator[None]:
        init_db(config.db_path)
        sync_manager = SyncManager(config.vault_path)
        app.state.sync_manager = sync_manager
        await sync_manager.start()
        try:
            yield
        finally:
            await sync_manager.stop()
            close_db()

    app = Litestar(
        route_handlers=[
            FilesController,
            VaultsController,
            ShareController,
            SettingsController,
            sync_doc,
            share_sync,
            share_page,
            share_info,
            health,
            serve_index,
            assets_router,
        ],
        dependencies={"config": Provide(lambda: config, sync_to_thread=False)},
        middleware=[AuthMiddleware],
        lifespan=[lifespan],
        cors_config=CORSConfig(allow_origins=["*"]),
        exception_handlers={
            PathTraversalError: _path_traversal_handler,
            FileNotFoundError: _file_not_found_handler,
            InvalidVaultName: _invalid_vault_name_handler,
            VaultNotFound: _vault_not_found_handler,
            VaultAlreadyExists: _vault_already_exists_handler,
        },
    )
    app.state.config = config
    return app
