"""Run the server: python -m server"""

import logging

import uvicorn

from server.core.config import load_config
from server.web.app import create_app

# websockets lib emits bare "connection open/closed" at INFO with no path or
# client context — uvicorn's access log already shows the WS path on accept.
logging.getLogger("websockets.server").setLevel(logging.WARNING)

config = load_config()
uvicorn.run(create_app(config), host=config.host, port=config.port, access_log=False)
