"""Server configuration."""

import os
from pathlib import Path

# Vault: directory containing .md notes
VAULT_PATH = Path(os.environ.get("MDNOTES_VAULT_PATH", os.path.expanduser("~/notes")))

# Server
HOST = os.environ.get("MDNOTES_HOST", "127.0.0.1")
PORT = int(os.environ.get("MDNOTES_PORT", "8080"))

# SQLite database for share links (Phase 5)
DB_PATH = Path(os.environ.get("MDNOTES_DB_PATH", str(VAULT_PATH / ".mdnotes.db")))

# Frontend dist directory (built by Vite)
FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"
