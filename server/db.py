"""SQLite database for share links and vaults."""

import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

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
        CREATE TABLE IF NOT EXISTS vaults (
            name       TEXT PRIMARY KEY,
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
    _conn.commit()


def _get_conn() -> sqlite3.Connection:
    if _conn is None:
        raise RuntimeError("Database not initialised — call init_db() first")
    return _conn


def create_link(doc_path: str, permission: str = "read") -> str:
    """Create a share link and return its UUID."""
    link_uuid = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    _get_conn().execute(
        "INSERT INTO share_links (uuid, doc_path, permission, created_at) VALUES (?, ?, ?, ?)",
        (link_uuid, doc_path, permission, now),
    )
    _get_conn().commit()
    return link_uuid


def get_link(link_uuid: str) -> dict | None:
    """Look up a share link by UUID. Returns dict or None."""
    row = _get_conn().execute(
        "SELECT uuid, doc_path, permission, created_at FROM share_links WHERE uuid = ?",
        (link_uuid,),
    ).fetchone()
    if row is None:
        return None
    return dict(row)


def delete_link(link_uuid: str) -> bool:
    """Delete a share link. Returns True if a row was deleted."""
    cur = _get_conn().execute(
        "DELETE FROM share_links WHERE uuid = ?", (link_uuid,)
    )
    _get_conn().commit()
    return cur.rowcount > 0


def close_db() -> None:
    """Close the database connection."""
    global _conn
    if _conn:
        _conn.close()
        _conn = None


# ── Vaults ────────────────────────────────────────────────────────────────


def list_vaults() -> list[dict]:
    rows = _get_conn().execute(
        "SELECT name, created_at FROM vaults ORDER BY created_at"
    ).fetchall()
    return [dict(r) for r in rows]


def get_vault(name: str) -> dict | None:
    row = _get_conn().execute(
        "SELECT name, created_at FROM vaults WHERE name = ?", (name,)
    ).fetchone()
    return dict(row) if row else None


def create_vault(name: str) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    _get_conn().execute(
        "INSERT INTO vaults (name, created_at) VALUES (?, ?)",
        (name, now),
    )
    _get_conn().commit()
    return {"name": name, "created_at": now}


def upsert_vault(name: str) -> dict:
    """Insert vault if missing. Used for auto-registration on first sync."""
    existing = get_vault(name)
    if existing:
        return existing
    return create_vault(name)


def rename_vault(old_name: str, new_name: str) -> bool:
    cur = _get_conn().execute(
        "UPDATE vaults SET name = ? WHERE name = ?", (new_name, old_name)
    )
    _get_conn().commit()
    return cur.rowcount > 0


def delete_vault(name: str) -> bool:
    cur = _get_conn().execute("DELETE FROM vaults WHERE name = ?", (name,))
    _get_conn().commit()
    return cur.rowcount > 0


def get_setting(key: str) -> str | None:
    row = _get_conn().execute(
        "SELECT value FROM settings WHERE key = ?", (key,)
    ).fetchone()
    return row["value"] if row else None


def set_setting(key: str, value: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    _get_conn().execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)"
        " ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        (key, value, now),
    )
    _get_conn().commit()


def list_links(doc_path: str | None = None) -> list[dict]:
    """List share links, optionally filtered by document path."""
    if doc_path:
        rows = _get_conn().execute(
            "SELECT uuid, doc_path, permission, created_at FROM share_links WHERE doc_path = ?",
            (doc_path,),
        ).fetchall()
    else:
        rows = _get_conn().execute(
            "SELECT uuid, doc_path, permission, created_at FROM share_links"
        ).fetchall()
    return [dict(r) for r in rows]
