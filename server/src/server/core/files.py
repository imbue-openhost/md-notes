"""Filesystem helpers for vault operations.

All path arguments are relative to the vault root and validated
to prevent directory traversal.
"""

import shutil
from pathlib import Path
from pathlib import PurePosixPath

from server.core import crdt_store
from server.models.files import FileEntry


class PathTraversalError(Exception):
    pass


def _resolve_and_validate(root: Path, rel_path: str) -> Path:
    """Resolve a relative path against root and verify it stays inside."""
    clean = PurePosixPath(rel_path)
    resolved = (root / clean).resolve()
    root_resolved = root.resolve()
    if not str(resolved).startswith(str(root_resolved) + "/") and resolved != root_resolved:
        raise PathTraversalError(f"Path escapes vault: {rel_path}")
    return resolved


def list_files(root: Path) -> list[FileEntry]:
    """Return a recursive listing of the vault as a tree of FileEntry."""
    root = root.resolve()

    def _walk(directory: Path) -> list[FileEntry]:
        entries: list[FileEntry] = []
        try:
            items = sorted(directory.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except PermissionError:
            return entries
        for item in items:
            if item.name.startswith("."):
                continue
            rel = str(item.relative_to(root))
            if item.is_dir():
                entries.append(FileEntry(name=item.name, path=rel, type="dir", children=_walk(item)))
            elif item.suffix == ".md":
                entries.append(FileEntry(name=item.name, path=rel, type="file", children=None))
        return entries

    return _walk(root)


def _crdt_args(root: Path, rel_path: str) -> tuple[Path, str]:
    """Map a vault-scoped path to crdt_store's coordinates.

    Sidecars live in one tree rooted next to the *vaults* directory (``<vaults>_crdt/<vault>/<rel>.bin``,
    the layout SyncManager writes), so ops on ``<vaults>/<vault>`` + ``<rel>`` translate to
    ``<vaults>`` + ``<vault>/<rel>``.
    """
    return root.parent, f"{root.name}/{rel_path}"


def read_file(root: Path, rel_path: str) -> str:
    """Read a file's contents as UTF-8 text."""
    target = _resolve_and_validate(root, rel_path)
    return target.read_text(encoding="utf-8")


def file_exists(root: Path, rel_path: str) -> bool:
    """True if ``rel_path`` is an existing file inside the vault."""
    try:
        return _resolve_and_validate(root, rel_path).is_file()
    except PathTraversalError:
        return False


def write_file(root: Path, rel_path: str, content: str) -> None:
    """Write content to a file, creating parent directories as needed."""
    target = _resolve_and_validate(root, rel_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def create_file(root: Path, rel_path: str, content: str) -> None:
    """Create a new file; refuse to overwrite an existing one."""
    target = _resolve_and_validate(root, rel_path)
    if target.exists():
        raise FileExistsError(f"Already exists: {rel_path}")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def create_directory(root: Path, rel_path: str) -> None:
    """Create a directory inside the vault."""
    target = _resolve_and_validate(root, rel_path)
    target.mkdir(parents=True, exist_ok=True)


def delete_file(root: Path, rel_path: str) -> None:
    """Delete a file or directory (recursively); propagate to CRDT sidecar tree."""
    target = _resolve_and_validate(root, rel_path)
    if target.is_dir():
        shutil.rmtree(target)
        crdt_store.delete_dir(*_crdt_args(root, rel_path))
    else:
        target.unlink()
        crdt_store.delete_state(*_crdt_args(root, rel_path))


def rename_file(root: Path, old_path: str, new_path: str) -> None:
    """Rename / move a file within the vault; propagate to CRDT sidecar tree."""
    src = _resolve_and_validate(root, old_path)
    dst = _resolve_and_validate(root, new_path)
    if dst.exists():
        raise FileExistsError(f"Already exists: {new_path}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    is_dir = src.is_dir()
    src.rename(dst)
    crdt_root, crdt_old = _crdt_args(root, old_path)
    _, crdt_new = _crdt_args(root, new_path)
    if is_dir:
        crdt_store.rename_dir(crdt_root, crdt_old, crdt_new)
    else:
        crdt_store.rename_state(crdt_root, crdt_old, crdt_new)
