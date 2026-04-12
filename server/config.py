"""Server configuration."""

import os
from pathlib import Path

# OpenHost data directories (set by the platform when deployed)
_app_data_dir = os.environ.get("OPENHOST_APP_DATA_DIR")
_sqlite_main = os.environ.get("OPENHOST_SQLITE_MAIN")

# Vault: directory containing .md notes
if _app_data_dir:
    VAULT_PATH = Path(_app_data_dir) / "vault"
else:
    VAULT_PATH = Path(os.environ.get("MDNOTES_VAULT_PATH", os.path.expanduser("~/notes")))

# Server
HOST = os.environ.get("MDNOTES_HOST", "0.0.0.0")
PORT = int(os.environ.get("MDNOTES_PORT", "8080"))

# SQLite database for share links
if _sqlite_main:
    DB_PATH = Path(_sqlite_main)
else:
    DB_PATH = Path(os.environ.get("MDNOTES_DB_PATH", str(VAULT_PATH / ".mdnotes.db")))

# Frontend dist directory (built by Vite)
FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"

# API key for authenticating the Tauri app and programmatic access.
# All routes except /share/ require this key.
API_KEY = os.environ.get("MDNOTES_API_KEY", "")
