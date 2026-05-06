"""Generate the OpenAPI spec and write it to server/openapi/openapi.json.

Exits 0 if unchanged, 1 if updated.
"""

import json
import os
import sys
from pathlib import Path

os.environ.setdefault("OPENHOST_APP_DATA_DIR", "/tmp/mdnotes-openapi")
os.environ.setdefault("OPENHOST_SQLITE_MAIN", "/tmp/mdnotes-openapi/main.db")
os.environ.setdefault("MDNOTES_FRONTEND_DIST", "/tmp")

from server.core.config import load_config  # noqa: E402
from server.web.app import create_app  # noqa: E402

spec_path = Path(__file__).parent / "openapi.json"

app = create_app(load_config())
new_content = json.dumps(app.openapi_schema.to_schema(), indent=2) + "\n"

old_content = spec_path.read_text() if spec_path.exists() else ""

if new_content == old_content:
    sys.exit(0)

spec_path.write_text(new_content)
print(f"Updated {spec_path}")
sys.exit(1)
