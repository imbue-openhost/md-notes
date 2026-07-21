"""Vault management: creating/listing/renaming/deleting vault directories under ``VAULT_PATH``.

A vault is a top-level subdirectory of the vault root; this module owns that mapping. File operations *within*
a vault live in ``server.vault``.
"""

import shutil
from pathlib import Path


class InvalidVaultName(Exception):
    pass


class VaultNotFound(Exception):
    pass


class VaultAlreadyExists(Exception):
    pass


def is_valid_name(name: str) -> bool:
    return bool(name) and "/" not in name and name not in (".", "..") and not name.startswith(".")


def vault_root(vault_path: Path, vault_name: str) -> Path:
    """Return the directory for ``vault_name``. Raises ``VaultNotFound`` if it doesn't exist."""
    root = vault_path / vault_name
    if not root.is_dir():
        raise VaultNotFound(vault_name)
    return root


def list_vault_names(vault_path: Path) -> list[str]:
    if not vault_path.exists():
        return []
    return [d.name for d in sorted(vault_path.iterdir()) if d.is_dir() and not d.name.startswith(".")]


def create_vault(vault_path: Path, name: str) -> str:
    """Create a vault directory, returning its name. Idempotent: an existing vault is fine."""
    name = name.strip()
    if not is_valid_name(name):
        raise InvalidVaultName(name)
    vault_dir = vault_path / name
    vault_dir.mkdir(parents=True, exist_ok=True)
    return name


def rename_vault(vault_path: Path, old_name: str, new_name: str) -> str:
    new_name = new_name.strip()
    if not is_valid_name(new_name):
        raise InvalidVaultName(new_name)
    old_dir = vault_path / old_name
    if not old_dir.is_dir():
        raise VaultNotFound(old_name)
    new_dir = vault_path / new_name
    if new_dir.exists():
        raise VaultAlreadyExists(new_name)
    old_dir.rename(new_dir)
    return new_name


def delete_vault(vault_path: Path, name: str) -> None:
    vault_dir = vault_path / name
    if not vault_dir.is_dir():
        raise VaultNotFound(name)
    shutil.rmtree(vault_dir)
