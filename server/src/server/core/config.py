"""Server configuration."""

import os
from pathlib import Path

import attr


@attr.s(auto_attribs=True, frozen=True)
class Config:
    vault_path: Path
    db_path: Path
    frontend_dist: Path
    host: str = "0.0.0.0"
    port: int = 8080


def _resolve_frontend_dist() -> Path:
    env = os.environ.get("MDNOTES_FRONTEND_DIST")
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent.parent.parent.parent / "frontend" / "dist"


def load_config() -> Config:
    app_data_dir = os.environ.get("OPENHOST_APP_DATA_DIR")
    if not app_data_dir:
        raise RuntimeError("OPENHOST_APP_DATA_DIR is not set — md-notes must run on OpenHost")

    sqlite_main = os.environ.get("OPENHOST_SQLITE_MAIN")
    if not sqlite_main:
        raise RuntimeError("OPENHOST_SQLITE_MAIN is not set — md-notes must run on OpenHost")

    return Config(
        vault_path=Path(app_data_dir) / "vault",
        db_path=Path(sqlite_main),
        frontend_dist=_resolve_frontend_dist(),
    )
