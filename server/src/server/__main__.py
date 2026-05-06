"""Run the server: python -m server"""

import logging

import uvicorn

from server.core.config import load_config
from server.web.app import create_app


# Drop noisy WS lifecycle logs that all flow through uvicorn.error:
#   - bare "connection open"/"connection closed" (from the websockets lib,
#     which uvicorn injects with uvicorn.error as its logger)
#   - uvicorn's own '... - "WebSocket /path" [accepted|403|N]' access lines
#     (these are on uvicorn.error, so access_log=False doesn't suppress them)
class _DropWebsocketNoise(logging.Filter):
    _bare = {"connection open", "connection closed"}

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.msg
        if msg in self._bare:
            return False
        if isinstance(msg, str) and msg.startswith('%s - "WebSocket'):
            return False
        return True


logging.getLogger("uvicorn.error").addFilter(_DropWebsocketNoise())

config = load_config()
# CRDT initial-state messages can exceed uvicorn's default 1 MiB websocket
# frame limit for large docs. Bump to 64 MiB so big notes sync.
WS_MAX_SIZE = 64 * 1024 * 1024
print(f"[md-notes] starting uvicorn with ws_max_size={WS_MAX_SIZE}", flush=True)
uvicorn.run(
    create_app(config),
    host=config.host,
    port=config.port,
    access_log=False,
    ws_max_size=WS_MAX_SIZE,
)
