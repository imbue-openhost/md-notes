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
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
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


# ── Vaults ────────────────────────────────────────────────────────────────


def list_vaults() -> list[dict]:
    rows = _get_conn().execute(
        "SELECT id, name, created_at FROM vaults ORDER BY created_at"
    ).fetchall()
    return [dict(r) for r in rows]


def get_vault(vault_id: str) -> dict | None:
    row = _get_conn().execute(
        "SELECT id, name, created_at FROM vaults WHERE id = ?", (vault_id,)
    ).fetchone()
    return dict(row) if row else None


def create_vault(name: str, vault_id: str | None = None) -> dict:
    vid = vault_id or uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    _get_conn().execute(
        "INSERT INTO vaults (id, name, created_at) VALUES (?, ?, ?)",
        (vid, name, now),
    )
    _get_conn().commit()
    return {"id": vid, "name": name, "created_at": now}


def upsert_vault(vault_id: str, name: str | None = None) -> dict:
    """Insert vault if missing. Used for auto-registration on first sync.

    Does not overwrite an existing name.
    """
    existing = get_vault(vault_id)
    if existing:
        return existing
    return create_vault(name or vault_id, vault_id=vault_id)


def rename_vault(vault_id: str, name: str) -> bool:
    cur = _get_conn().execute(
        "UPDATE vaults SET name = ? WHERE id = ?", (name, vault_id)
    )
    _get_conn().commit()
    return cur.rowcount > 0


def delete_vault(vault_id: str) -> bool:
    cur = _get_conn().execute("DELETE FROM vaults WHERE id = ?", (vault_id,))
    _get_conn().commit()
    return cur.rowcount > 0


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
