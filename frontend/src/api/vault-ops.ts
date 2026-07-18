/**
 * Vault-aware file operations via the REST API.
 *
 * Routes to the local server for normal vaults and directly to the sharing instance's peer API
 * for remote (federated) vaults.
 */

import type { FileEntry, VaultConfig } from './types';
import * as api from './client';
import * as peer from './peer';
import { clearVaultDocCache, clearRemoteVaultDocCache } from '../editor/sync';

let activeVault: VaultConfig | null = null;

export function setActiveVault(vault: VaultConfig): void {
  activeVault = vault;
}

export function getActiveVault(): VaultConfig | null {
  return activeVault;
}

function requireVault(): VaultConfig {
  if (!activeVault?.name) throw new Error('No active vault');
  return activeVault;
}

/** True when the active vault is a remote share we can't write to. */
export function isActiveVaultReadOnly(): boolean {
  return activeVault?.remote?.permission === 'read';
}

export async function listFiles(): Promise<FileEntry[]> {
  const vault = requireVault();
  return vault.remote ? peer.listFiles(vault.remote) : api.listFiles(vault.name);
}

export async function readFile(path: string): Promise<string> {
  const vault = requireVault();
  return vault.remote ? peer.readFile(vault.remote, path) : api.readFile(vault.name, path);
}

export async function createFile(path: string, content = '', type: 'file' | 'dir' = 'file'): Promise<void> {
  const vault = requireVault();
  if (vault.remote) await peer.createFile(vault.remote, path, content, type);
  else await api.createFile(vault.name, path, content, type);
}

export async function renameFile(oldPath: string, newPath: string): Promise<void> {
  const vault = requireVault();
  if (vault.remote) await peer.renameFile(vault.remote, oldPath, newPath);
  else await api.renameFile(vault.name, oldPath, newPath);
}

export async function deleteFile(path: string): Promise<void> {
  const vault = requireVault();
  // Drop any cached CRDT state so a future file at this path doesn't open
  // pre-populated with the deleted doc's content.
  if (vault.remote) {
    await peer.deleteFile(vault.remote, path);
    await clearRemoteVaultDocCache(vault.remote.id, path);
  } else {
    await api.deleteFile(vault.name, path);
    await clearVaultDocCache(vault.name, path);
  }
}
