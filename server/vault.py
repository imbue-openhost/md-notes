"""Filesystem helpers for vault operations.

All path arguments are relative to the vault root and validated
to prevent directory traversal.
"""

from pathlib import Path, PurePosixPath


class PathTraversalError(Exception):
    pass


def _resolve_and_validate(root: Path, rel_path: str) -> Path:
    """Resolve a relative path against root and verify it stays inside."""
    # Normalise the relative path (collapse ..)
    clean = PurePosixPath(rel_path)
    resolved = (root / clean).resolve()
    root_resolved = root.resolve()
    if not str(resolved).startswith(str(root_resolved) + "/") and resolved != root_resolved:
        raise PathTraversalError(f"Path escapes vault: {rel_path}")
    return resolved


def list_files(root: Path) -> list[dict]:
    """Return a recursive listing of the vault as a JSON-serialisable tree.

    Each entry: {"name": str, "path": str, "type": "file"|"dir",
                 "children": [...] | None}
    """
    root = root.resolve()

    def _walk(directory: Path) -> list[dict]:
        entries: list[dict] = []
        try:
            items = sorted(directory.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except PermissionError:
            return entries
        for item in items:
            if item.name.startswith("."):
                continue
            rel = str(item.relative_to(root))
            if item.is_dir():
                entries.append({
                    "name": item.name,
                    "path": rel,
                    "type": "dir",
                    "children": _walk(item),
                })
            elif item.suffix == ".md":
                entries.append({
                    "name": item.name,
                    "path": rel,
                    "type": "file",
                    "children": None,
                })
        return entries

    return _walk(root)


def read_file(root: Path, rel_path: str) -> str:
    """Read a file's contents as UTF-8 text."""
    target = _resolve_and_validate(root, rel_path)
    return target.read_text(encoding="utf-8")


def write_file(root: Path, rel_path: str, content: str) -> None:
    """Write content to a file, creating parent directories as needed."""
    target = _resolve_and_validate(root, rel_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def create_directory(root: Path, rel_path: str) -> None:
    """Create a directory inside the vault."""
    target = _resolve_and_validate(root, rel_path)
    target.mkdir(parents=True, exist_ok=True)


def delete_file(root: Path, rel_path: str) -> None:
    """Delete a file or empty directory."""
    target = _resolve_and_validate(root, rel_path)
    if target.is_dir():
        target.rmdir()  # only removes empty dirs
    else:
        target.unlink()


def rename_file(root: Path, old_path: str, new_path: str) -> None:
    """Rename / move a file within the vault."""
    src = _resolve_and_validate(root, old_path)
    dst = _resolve_and_validate(root, new_path)
    dst.parent.mkdir(parents=True, exist_ok=True)
    src.rename(dst)
