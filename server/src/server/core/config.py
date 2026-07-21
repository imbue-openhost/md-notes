"""Server configuration."""

import os
from pathlib import Path

import attr


@attr.s(auto_attribs=True, frozen=True)
class Config:
    # Root directory containing vault subdirectories (each vault is a folder of .md files)
    vault_path: Path
    # SQLite database for share links and settings
    db_path: Path
    # Owner's display name, used to label the owner's comments
    owner_name: str = "owner"
    host: str = "0.0.0.0"
    port: int = 8000
    # Public origin of this app instance (e.g. "https://md-notes.alice.selfhost.imbue.com"); federation
    # invite links point here. Empty only in unit tests that construct Config directly.
    app_origin: str = ""


def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is not set — md-notes must run on OpenHost")
    return value


def load_config() -> Config:
    app_data_dir = _require_env("OPENHOST_APP_DATA_DIR")
    sqlite_main = _require_env("OPENHOST_SQLITE_MAIN")
    app_name = _require_env("OPENHOST_APP_NAME")
    zone_domain = _require_env("OPENHOST_ZONE_DOMAIN")

    # The local test harness serves zones on plain HTTP at <name>.localhost:<port>.
    scheme = "http" if "localhost" in zone_domain else "https"
    return Config(
        vault_path=Path(app_data_dir) / "vault",
        db_path=Path(sqlite_main),
        app_origin=f"{scheme}://{app_name}.{zone_domain}",
        # The platform documents "owner" as the default when the operator hasn't configured a name.
        owner_name=os.environ.get("OPENHOST_OWNER_USERNAME", "owner"),
    )
