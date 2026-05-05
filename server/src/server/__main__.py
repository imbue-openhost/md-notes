"""Run the server: python -m server"""

import uvicorn

from server.core.config import HOST
from server.core.config import PORT
from server.web.app import create_app

uvicorn.run(create_app(), host=HOST, port=PORT)
