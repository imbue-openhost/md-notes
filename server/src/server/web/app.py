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
from litestar.di import Provide

from server.core.config import Config
from server.core.db import close_db
from server.core.db import init_db
from server.core.files import PathTraversalError
from server.core.history import HistoryManager
from server.core.sync import SyncManager
from server.core.vaults import InvalidVaultName
from server.core.vaults import VaultAlreadyExists
from server.core.vaults import VaultNotFound
from server.web.api.docs import DocsController
from server.web.api.settings import SettingsController
from server.web.api.share import ShareController
from server.web.api.vaults import VaultsController
from server.web.auth import requires_owner


@get("/health", media_type=MediaType.TEXT, opt={"public": True})
async def health() -> str:
    return "ok"


# Authed counterpart used by the frontend heartbeat: passes the owner guard, so a
# failure distinguishes disconnected from unauthorized.
@get("/api/health", media_type=MediaType.TEXT)
async def api_health() -> str:
    return "ok"


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

    @asynccontextmanager
    async def lifespan(app: Litestar) -> AsyncIterator[None]:
        init_db(config.db_path)
        sync_manager = SyncManager(config.vault_path)
        app.state.sync_manager = sync_manager
        await sync_manager.start()
        history_manager = HistoryManager(config.vault_path)
        app.state.history_manager = history_manager
        await history_manager.start()
        try:
            yield
        finally:
            await history_manager.stop()
            await sync_manager.stop()
            close_db()

    app = Litestar(
        route_handlers=[
            DocsController,
            VaultsController,
            ShareController,
            SettingsController,
            health,
            api_health,
        ],
        dependencies={"config": Provide(lambda: config, sync_to_thread=False)},
        guards=[requires_owner],
        lifespan=[lifespan],
        cors_config=CORSConfig(allow_origins=["*"]),
        # Loguru owns logging — see __main__.py for the InterceptHandler bridge.
        logging_config=None,
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
