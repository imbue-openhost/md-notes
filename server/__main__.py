"""Run the server: python -m server"""

from .app import create_app
from .config import HOST, PORT

app = create_app()
app.run(host=HOST, port=PORT)
