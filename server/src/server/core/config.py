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
        # The platform documents "owner" as the default when the operator hasn't configured a name.
        owner_name=os.environ.get("OPENHOST_OWNER_USERNAME", "owner"),
    )
