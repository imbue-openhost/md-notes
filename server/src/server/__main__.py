"""Run the server: python -m server"""

import asyncio
import inspect
import logging
import sys
from typing import cast

from hypercorn.asyncio import serve
from hypercorn.config import Config as HypercornConfig
from hypercorn.typing import ASGIFramework
from loguru import logger

from server.core.config import load_config
from server.web.app import create_app


class _InterceptHandler(logging.Handler):
    """Forward stdlib log records into loguru so third-party libs (hypercorn, litestar)
    share one sink and format with our own loguru-based logging."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            level: str | int = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno
        frame, depth = inspect.currentframe(), 0
        while frame and (depth == 0 or frame.f_code.co_filename == logging.__file__):
            frame = frame.f_back
            depth += 1
        logger.opt(depth=depth, exception=record.exc_info).log(level, record.getMessage())


def _setup_logging() -> logging.Logger:
    logger.remove()
    logger.add(
        sys.stderr,
        format="<green>{time:HH:mm:ss.SSS}</green> | <level>{level: <8}</level> | "
        "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
        level="DEBUG",
    )
    logging.basicConfig(handlers=[_InterceptHandler()], level=logging.DEBUG, force=True)
    # Pre-build hypercorn.error so its _create_logger returns it as-is instead of
    # replacing our handlers with its own StreamHandler.
    hc_error = logging.getLogger("hypercorn.error")
    hc_error.handlers = [_InterceptHandler()]
    hc_error.propagate = False
    hc_error.setLevel(logging.DEBUG)
    return hc_error


hc_error_logger = _setup_logging()
config = load_config()

hc = HypercornConfig()
hc.bind = [f"{config.host}:{config.port}"]
# CRDT initial-state messages can exceed the default 1 MiB websocket message
# size for large docs. Bump to 64 MiB so big notes sync.
hc.websocket_max_message_size = 64 * 1024 * 1024
hc.accesslog = None
hc.errorlog = hc_error_logger

asyncio.run(serve(cast(ASGIFramework, create_app(config)), hc))
