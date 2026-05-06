"""Run the server: python -m server"""

import asyncio
from typing import cast

from hypercorn.asyncio import serve
from hypercorn.config import Config as HypercornConfig
from hypercorn.typing import ASGIFramework

from server.core.config import load_config
from server.web.app import create_app

config = load_config()

hc = HypercornConfig()
hc.bind = [f"{config.host}:{config.port}"]
# CRDT initial-state messages can exceed the default 1 MiB websocket message
# size for large docs. Bump to 64 MiB so big notes sync.
hc.websocket_max_message_size = 64 * 1024 * 1024
# Disable access logging — we don't want a line per request.
hc.accesslog = None
hc.errorlog = "-"

asyncio.run(serve(cast(ASGIFramework, create_app(config)), hc))
