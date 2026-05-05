"""Run the server: python -m server"""

import uvicorn

from server.core.config import load_config
from server.web.app import create_app

config = load_config()
uvicorn.run(create_app(config), host=config.host, port=config.port)
