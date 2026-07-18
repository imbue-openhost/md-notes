"""SQLite database for share links, vault shares, remote vaults, and settings."""

import sqlite3
import uuid
from datetime import UTC
from datetime import datetime
from pathlib import Path
from typing import Literal

from server.models.federation import RemoteVault
from server.models.federation import VaultShare
from server.models.share import ShareLink

_db_path: Path | None = None
_conn: sqlite3.Connection | None = None


def init_db(path: Path) -> None:
    """Initialise the SQLite database and create tables if needed."""
    global _db_path, _conn
    _db_path = path
    _conn = sqlite3.connect(str(path))
    _conn.row_factory = sqlite3.Row
    _conn.execute("""
        CREATE TABLE IF NOT EXISTS share_links (
            uuid       TEXT PRIMARY KEY,
            doc_path   TEXT NOT NULL,
            permission TEXT NOT NULL CHECK (permission IN ('read', 'write')),
            created_at TEXT NOT NULL
        )
    """)
    _conn.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    _conn.execute("""
        CREATE TABLE IF NOT EXISTS vault_shares (
            secret     TEXT PRIMARY KEY,
            vault_name TEXT NOT NULL,
            share_name TEXT NOT NULL,
            permission TEXT NOT NULL CHECK (permission IN ('read', 'write')),
            created_at TEXT NOT NULL
        )
    """)
    _conn.execute("""
        CREATE TABLE IF NOT EXISTS remote_vaults (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL UNIQUE,
            source_url TEXT NOT NULL,
            vault_name TEXT NOT NULL,
            secret     TEXT NOT NULL,
            permission TEXT NOT NULL CHECK (permission IN ('read', 'write')),
            created_at TEXT NOT NULL
        )
    """)
    _conn.commit()


def _get_conn() -> sqlite3.Connection:
    if _conn is None:
        raise RuntimeError("Database not initialised — call init_db() first")
    return _conn


def _row_to_link(row: sqlite3.Row) -> ShareLink:
    return ShareLink(
        uuid=row["uuid"],
        doc_path=row["doc_path"],
        permission=row["permission"],
        created_at=row["created_at"],
    )


def create_link(doc_path: str, permission: str = "read") -> str:
    """Create a share link and return its UUID."""
    link_uuid = uuid.uuid4().hex
    now = datetime.now(UTC).isoformat()
    _get_conn().execute(
        "INSERT INTO share_links (uuid, doc_path, permission, created_at) VALUES (?, ?, ?, ?)",
        (link_uuid, doc_path, permission, now),
    )
    _get_conn().commit()
    return link_uuid


def get_link(link_uuid: str) -> ShareLink | None:
    """Look up a share link by UUID."""
    row = (
        _get_conn()
        .execute(
            "SELECT uuid, doc_path, permission, created_at FROM share_links WHERE uuid = ?",
            (link_uuid,),
        )
        .fetchone()
    )
    if row is None:
        return None
    return _row_to_link(row)


def delete_link(link_uuid: str) -> bool:
    """Delete a share link. Returns True if a row was deleted."""
    cur = _get_conn().execute("DELETE FROM share_links WHERE uuid = ?", (link_uuid,))
    _get_conn().commit()
    return cur.rowcount > 0


def close_db() -> None:
    """Close the database connection."""
    global _conn
    if _conn:
        _conn.close()
        _conn = None


def get_setting(key: str) -> str | None:
    row = _get_conn().execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def set_setting(key: str, value: str) -> None:
    now = datetime.now(UTC).isoformat()
    _get_conn().execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)"
        " ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        (key, value, now),
    )
    _get_conn().commit()


def _row_to_vault_share(row: sqlite3.Row) -> VaultShare:
    return VaultShare(
        secret=row["secret"],
        vault_name=row["vault_name"],
        share_name=row["share_name"],
        permission=row["permission"],
        created_at=row["created_at"],
    )


def create_vault_share(vault_name: str, share_name: str, permission: Literal["read", "write"]) -> VaultShare:
    secret = uuid.uuid4().hex
    now = datetime.now(UTC).isoformat()
    _get_conn().execute(
        "INSERT INTO vault_shares (secret, vault_name, share_name, permission, created_at) VALUES (?, ?, ?, ?, ?)",
        (secret, vault_name, share_name, permission, now),
    )
    _get_conn().commit()
    return VaultShare(
        secret=secret, vault_name=vault_name, share_name=share_name, permission=permission, created_at=now
    )


def get_vault_share(secret: str) -> VaultShare | None:
    row = _get_conn().execute("SELECT * FROM vault_shares WHERE secret = ?", (secret,)).fetchone()
    return _row_to_vault_share(row) if row else None


def delete_vault_share(secret: str) -> bool:
    cur = _get_conn().execute("DELETE FROM vault_shares WHERE secret = ?", (secret,))
    _get_conn().commit()
    return cur.rowcount > 0


def list_vault_shares(vault_name: str | None = None) -> list[VaultShare]:
    if vault_name:
        rows = (
            _get_conn()
            .execute("SELECT * FROM vault_shares WHERE vault_name = ? ORDER BY created_at", (vault_name,))
            .fetchall()
        )
    else:
        rows = _get_conn().execute("SELECT * FROM vault_shares ORDER BY created_at").fetchall()
    return [_row_to_vault_share(r) for r in rows]


def _row_to_remote_vault(row: sqlite3.Row) -> RemoteVault:
    return RemoteVault(
        id=row["id"],
        name=row["name"],
        source_url=row["source_url"],
        vault_name=row["vault_name"],
        secret=row["secret"],
        permission=row["permission"],
        created_at=row["created_at"],
    )


def add_remote_vault(
    name: str, source_url: str, vault_name: str, secret: str, permission: Literal["read", "write"]
) -> RemoteVault:
    vault_id = uuid.uuid4().hex
    now = datetime.now(UTC).isoformat()
    _get_conn().execute(
        "INSERT INTO remote_vaults (id, name, source_url, vault_name, secret, permission, created_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        (vault_id, name, source_url, vault_name, secret, permission, now),
    )
    _get_conn().commit()
    return RemoteVault(
        id=vault_id,
        name=name,
        source_url=source_url,
        vault_name=vault_name,
        secret=secret,
        permission=permission,
        created_at=now,
    )


def get_remote_vault(vault_id: str) -> RemoteVault | None:
    row = _get_conn().execute("SELECT * FROM remote_vaults WHERE id = ?", (vault_id,)).fetchone()
    return _row_to_remote_vault(row) if row else None


def delete_remote_vault(vault_id: str) -> bool:
    cur = _get_conn().execute("DELETE FROM remote_vaults WHERE id = ?", (vault_id,))
    _get_conn().commit()
    return cur.rowcount > 0


def list_remote_vaults() -> list[RemoteVault]:
    rows = _get_conn().execute("SELECT * FROM remote_vaults ORDER BY created_at").fetchall()
    return [_row_to_remote_vault(r) for r in rows]


def list_links(doc_path: str | None = None) -> list[ShareLink]:
    """List share links, optionally filtered by document path."""
    if doc_path:
        rows = (
            _get_conn()
            .execute(
                "SELECT uuid, doc_path, permission, created_at FROM share_links WHERE doc_path = ?",
                (doc_path,),
            )
            .fetchall()
        )
    else:
        rows = _get_conn().execute("SELECT uuid, doc_path, permission, created_at FROM share_links").fetchall()
    return [_row_to_link(r) for r in rows]
