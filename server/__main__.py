"""Run the server: python -m server"""

import uvicorn

from server.app import create_app
from server.config import HOST
from server.config import PORT

uvicorn.run(create_app(), host=HOST, port=PORT)
