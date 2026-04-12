"""SQLite database for share links."""

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
