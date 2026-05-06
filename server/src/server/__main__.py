"""Run the server: python -m server"""

import logging

import uvicorn

from server.core.config import load_config
from server.web.app import create_app

# websockets lib emits bare "connection open/closed" at INFO with no path or
# client context. Silence the whole package; we get path info from app code.
logging.getLogger("websockets").setLevel(logging.WARNING)

config = load_config()
# CRDT initial-state messages can exceed uvicorn's default 1 MiB websocket
# frame limit for large docs. Bump to 64 MiB so big notes sync.
uvicorn.run(
    create_app(config),
    host=config.host,
    port=config.port,
    access_log=False,
    ws_max_size=64 * 1024 * 1024,
)
