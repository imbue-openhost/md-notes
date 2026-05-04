"""Run the server: python -m server"""

from server.app import create_app
from server.config import HOST
from server.config import PORT

app = create_app()
app.run(host=HOST, port=PORT)
