"""Vault management: creating/listing/renaming/deleting vault directories under ``VAULT_PATH``.

A vault is a top-level subdirectory of the vault root; this module owns that mapping. File operations *within*
a vault live in ``server.vault``.
"""

import shutil
from pathlib import Path

from server.models.vaults import Vault


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


def list_vaults(vault_path: Path) -> list[Vault]:
    if not vault_path.exists():
        return []
    return [Vault(name=d.name) for d in sorted(vault_path.iterdir()) if d.is_dir() and not d.name.startswith(".")]


def create_vault(vault_path: Path, name: str) -> Vault:
    """Create a vault. Idempotent: returns the existing vault if already present."""
    name = name.strip()
    if not is_valid_name(name):
        raise InvalidVaultName(name)
    vault_dir = vault_path / name
    vault_dir.mkdir(parents=True, exist_ok=True)
    return Vault(name=name)


def rename_vault(vault_path: Path, old_name: str, new_name: str) -> Vault:
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
    return Vault(name=new_name)


def delete_vault(vault_path: Path, name: str) -> None:
    vault_dir = vault_path / name
    if not vault_dir.is_dir():
        raise VaultNotFound(name)
    shutil.rmtree(vault_dir)
