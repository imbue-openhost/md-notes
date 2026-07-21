"""Sidecar persistence for Y.Doc state, in a parallel tree alongside the vault.

Vault at ``<data>/vault/`` ↔ sidecars at ``<data>/vault_crdt/<rel_path>.bin``. Same path-traversal guard as
files.py. Loaded by sync.SyncManager on room init so reconnecting clients sync against the same internal
clientID/clocks they last saw — no doubling.
"""

import os
import shutil
from pathlib import Path
from pathlib import PurePosixPath


class PathTraversalError(Exception):
    pass


def crdt_root(vault_root: Path) -> Path:
    return vault_root.parent / f"{vault_root.name}_crdt"


def _sidecar_path(vault_root: Path, rel_path: str) -> Path:
    root = crdt_root(vault_root)
    clean = PurePosixPath(rel_path)
    resolved = (root / f"{clean}.bin").resolve()
    root_resolved = root.resolve()
    if not str(resolved).startswith(str(root_resolved) + "/"):
        raise PathTraversalError(f"Sidecar path escapes crdt root: {rel_path}")
    return resolved


def read_state(vault_root: Path, rel_path: str) -> bytes | None:
    target = _sidecar_path(vault_root, rel_path)
    if not target.exists():
        return None
    return target.read_bytes()


def write_state(vault_root: Path, rel_path: str, update_bytes: bytes) -> None:
    target = _sidecar_path(vault_root, rel_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".tmp")
    tmp.write_bytes(update_bytes)
    os.replace(tmp, target)


def delete_state(vault_root: Path, rel_path: str) -> None:
    target = _sidecar_path(vault_root, rel_path)
    target.unlink(missing_ok=True)


def rename_state(vault_root: Path, old_path: str, new_path: str) -> None:
    src = _sidecar_path(vault_root, old_path)
    if not src.exists():
        return
    dst = _sidecar_path(vault_root, new_path)
    dst.parent.mkdir(parents=True, exist_ok=True)
    src.rename(dst)


def _dir_path(vault_root: Path, rel_path: str) -> Path:
    root = crdt_root(vault_root)
    clean = PurePosixPath(rel_path)
    resolved = (root / clean).resolve()
    root_resolved = root.resolve()
    if not str(resolved).startswith(str(root_resolved) + "/") and resolved != root_resolved:
        raise PathTraversalError(f"Sidecar dir path escapes crdt root: {rel_path}")
    return resolved


def delete_dir(vault_root: Path, rel_path: str) -> None:
    target = _dir_path(vault_root, rel_path)
    if target.is_dir():
        shutil.rmtree(target, ignore_errors=True)


def rename_dir(vault_root: Path, old_path: str, new_path: str) -> None:
    src = _dir_path(vault_root, old_path)
    if not src.is_dir():
        return
    dst = _dir_path(vault_root, new_path)
    dst.parent.mkdir(parents=True, exist_ok=True)
    src.rename(dst)
